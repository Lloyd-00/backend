import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

const normalizePhilippineMobile = (mobile) => {
    if (!mobile) return "";

    const cleaned = String(mobile).trim().replace(/[\s()-]/g, "");

    if (cleaned.startsWith("+")) return cleaned;
    if (cleaned.startsWith("09")) return `+63${cleaned.slice(1)}`;
    if (cleaned.startsWith("9") && cleaned.length === 10) return `+63${cleaned}`;
    if (cleaned.startsWith("639")) return `+${cleaned}`;

    return cleaned;
};

const getSmsErrorMessage = (err) => {
    const data = err.response?.data;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    return err.message || "Unknown SMS error";
};

// Helper to process a single job (send to users according to channel)
async function processJob(job) {
    const { users, message, channel } = job;

    const results = [];
    const recipients = [];
    const recipientIndices = [];

    for (const user of users) {
        let emailStatus = "skipped";
        let smsStatus = "skipped";
        let smsError = null;

        if ((channel === "email" || channel === "both") && user.email) {
            try {
                await transporter.sendMail({
                    from: process.env.GMAIL_USER,
                    to: user.email,
                    subject: message.title,
                    text: message.content,
                });
                emailStatus = "sent";
            } catch (err) {
                console.error("Email failed:", err?.message || err);
                emailStatus = "failed";
            }
        }

        if ((channel === "sms" || channel === "both") && user.mobile) {
            const recipient = normalizePhilippineMobile(user.mobile);
            if (recipient) {
                recipients.push(recipient);
                recipientIndices.push(results.length);
                smsStatus = "pending";
            }
        }

        results.push({
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            emailStatus,
            smsStatus,
            smsError,
        });
    }

    if (recipients.length > 0 && (channel === "sms" || channel === "both")) {
        try {
            await axios.post(
                "https://unismsapi.com/blast",
                {
                    metadata: {
                        campaign: process.env.UNISMS_CAMPAIGN || `announcement_${Date.now()}`,
                    },
                    content: `${message.title}\n${message.content}`,
                    ...(process.env.UNISMS_SENDER_ID ? { sender_id: process.env.UNISMS_SENDER_ID } : {}),
                    recipients,
                },
                {
                    auth: {
                        username: process.env.UNISMS_SECRET_KEY,
                        password: "",
                    },
                    headers: {
                        "Content-Type": "application/json",
                    },
                    timeout: 15000,
                }
            );

            recipientIndices.forEach((resultIndex) => {
                results[resultIndex].smsStatus = "sent";
            });
        } catch (err) {
            const smsError = getSmsErrorMessage(err);
            console.error("SMS blast failed:", {
                recipients,
                status: err.response?.status,
                error: smsError,
            });
            recipientIndices.forEach((resultIndex) => {
                results[resultIndex].smsStatus = "failed";
                results[resultIndex].smsError = smsError;
            });
        }
    }

    // For now we just log results; could be persisted to DB in future
    console.log(`Processed job ${job.id}:`, results);
    return results;
}

// In-memory queue (simple): enqueue jobs and process them in background
const queue = [];
let nextJobId = 1;

app.post("/enqueue", async (req, res) => {
    try {
        const { users, message, channel = "both" } = req.body;

        if (!Array.isArray(users) || !message) return res.status(400).json({ error: "Invalid payload" });

        const job = {
            id: nextJobId++,
            users,
            message,
            channel,
            createdAt: new Date().toISOString(),
        };

        queue.push(job);

        // Respond immediately — job will be processed by background worker
        return res.json({ queued: true, id: job.id });
    } catch (err) {
        console.error("Enqueue error:", err);
        return res.status(500).json({ error: "Failed to enqueue" });
    }
});

// Immediate send endpoint (keeps previous behavior) — accepts optional `channel` param
app.post("/send-notification", async (req, res) => {
    try {
        const { users, message, channel = "both" } = req.body;

        console.log("/send-notification payload", {
            userCount: Array.isArray(users) ? users.length : null,
            hasMessage: Boolean(message),
            channel,
        });

        if (!Array.isArray(users) || !message) {
            return res.status(400).json({ error: "Invalid payload" });
        }

        const job = { id: nextJobId++, users, message, channel };
        const results = await processJob(job);

        res.json({ results });
    } catch (err) {
        const details = err.response?.data || err.message || null;
        console.error("Send error:", err.message || err, details);
        res.status(500).json({
            error: err.message || "Failed to send notifications",
            details,
        });
    }
});

// Background worker: process one job at a time every second
setInterval(() => {
    if (queue.length === 0) return;
    const job = queue.shift();
    processJob(job).catch((err) => console.error(`Job ${job.id} failed:`, err));
}, 1000);

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
