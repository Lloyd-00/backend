import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: !SMTP_SECURE,
    family: 4,
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

const hasValue = (value) => Boolean(String(value || "").trim());

const getConfigStatus = () => ({
    email: {
        ready: hasValue(process.env.GMAIL_USER) && hasValue(process.env.GMAIL_PASS),
        smtp: {
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            family: 4,
        },
        missing: [
            !hasValue(process.env.GMAIL_USER) && "GMAIL_USER",
            !hasValue(process.env.GMAIL_PASS) && "GMAIL_PASS",
        ].filter(Boolean),
    },
    sms: {
        ready: hasValue(process.env.UNISMS_SECRET_KEY),
        missing: [
            !hasValue(process.env.UNISMS_SECRET_KEY) && "UNISMS_SECRET_KEY",
        ].filter(Boolean),
        senderIdConfigured: hasValue(process.env.UNISMS_SENDER_ID),
        warnings: [
            hasValue(process.env.UNISMS_SENDER_ID) &&
                "UNISMS_SENDER_ID is set. Remove it if the sender ID is not approved in UniSMS.",
        ].filter(Boolean),
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
        let emailError = null;
        let smsStatus = "skipped";
        let smsError = null;

        if ((channel === "email" || channel === "both") && user.email) {
            if (!getConfigStatus().email.ready) {
                emailStatus = "failed";
                emailError = "Email is not configured. Set GMAIL_USER and GMAIL_PASS on the backend.";
            } else {
                try {
                    await transporter.sendMail({
                        from: process.env.GMAIL_USER,
                        to: user.email,
                        subject: message.title,
                        text: message.content,
                    });
                    emailStatus = "sent";
                } catch (err) {
                    emailError = err?.message || "Unknown email error";
                    console.error("Email failed:", emailError);
                    emailStatus = "failed";
                }
            }
        }

        if ((channel === "sms" || channel === "both") && user.mobile) {
            if (!getConfigStatus().sms.ready) {
                smsStatus = "failed";
                smsError = "SMS is not configured. Set UNISMS_SECRET_KEY on the backend.";
            } else {
                const recipient = normalizePhilippineMobile(user.mobile);
                if (recipient) {
                    recipients.push(recipient);
                    recipientIndices.push(results.length);
                    smsStatus = "pending";
                } else {
                    smsStatus = "failed";
                    smsError = "Invalid mobile number.";
                }
            }
        }

        results.push({
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            emailStatus,
            emailError,
            smsStatus,
            smsError,
        });
    }

    if (recipients.length > 0 && (channel === "sms" || channel === "both")) {
        try {
            const smsResponse = await axios.post(
                "https://unismsapi.com/api/blast",
                {
                    metadata: {
                        campaign: process.env.UNISMS_CAMPAIGN || `announcement_${Date.now()}`,
                    },
                    content: `${message.title}\n${message.content}`.slice(0, 160),
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
                results[resultIndex].smsReference = smsResponse.data?.blast_id || null;
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

const summarizeResults = (results) => {
    const requested = {
        email: results.filter((result) => result.emailStatus !== "skipped").length,
        sms: results.filter((result) => result.smsStatus !== "skipped").length,
    };
    const sent = {
        email: results.filter((result) => result.emailStatus === "sent").length,
        sms: results.filter((result) => result.smsStatus === "sent").length,
    };
    const failures = results.flatMap((result) => [
        result.emailStatus === "failed" && result.emailError,
        result.smsStatus === "failed" && result.smsError,
    ].filter(Boolean));

    return {
        requested,
        sent,
        failures,
        ok: failures.length === 0 && sent.email + sent.sms > 0,
    };
};

// In-memory queue (simple): enqueue jobs and process them in background
const queue = [];
let nextJobId = 1;

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        config: getConfigStatus(),
    });
});

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
        const summary = summarizeResults(results);

        res.status(summary.ok ? 200 : 502).json({ results, summary });
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
