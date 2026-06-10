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

app.post("/send-notification", async (req, res) => {
    const { users, message, channel = "both" } = req.body;

    const results = [];

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
                console.error("Email failed:", err.message);
                emailStatus = "failed";
            }
        }

        if ((channel === "sms" || channel === "both") && user.mobile) {
            const recipient = normalizePhilippineMobile(user.mobile);

            try {
                await axios.post(
                    "https://unismsapi.com/api/sms",
                    {
                        recipient,
                        content: `${message.title}\n${message.content}`,
                        ...(process.env.UNISMS_SENDER_ID
                            ? { sender_id: process.env.UNISMS_SENDER_ID }
                            : {}),
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
                smsStatus = "sent";
            } catch (err) {
                smsError = getSmsErrorMessage(err);
                console.error("SMS failed:", {
                    recipient,
                    status: err.response?.status,
                    error: smsError,
                });
                smsStatus = "failed";
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

    res.json({ results });
});

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
