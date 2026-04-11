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

app.post("/send-notification", async (req, res) => {
    const { users, message } = req.body;

    const results = [];

    for (const user of users) {
        let emailStatus = "skipped";
        let smsStatus = "skipped";

        if (user.email) {
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

        if (user.mobile) {
            try {
                await axios.post(
                    "https://unismsapi.com/api/sms",
                    {
                        recipient: user.mobile,
                        content: `${message.title}\n${message.content}`,
                    },
                    {
                        auth: {
                            username: process.env.UNISMS_SECRET_KEY,
                            password: "",
                        },
                    }
                );
                smsStatus = "sent";
            } catch (err) {
                console.error("SMS failed:", err.response?.data || err.message);
                smsStatus = "failed";
            }
        }

        results.push({
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            emailStatus,
            smsStatus,
        });
    }

    res.json({ results });
});

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});