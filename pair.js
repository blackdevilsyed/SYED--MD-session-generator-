import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

/* ===== SHORT SESSION ID GENERATOR WITH BASE64 ENCODING ===== */
async function generateShortSession(credsPath) {
    try {
        const credsData = fs.readFileSync(credsPath, 'utf-8');
        const base64Creds = Buffer.from(credsData).toString('base64');

        const sessionId = `SYED-MD~`;

        return {
            sessionId: sessionId,
            encodedData: base64Creds
        };
    } catch (error) {
        console.error("Error generating short session:", error);
        return null;
    }
}

/* ===== HELPERS ===== */
function rm(p) {
    try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch(e) {
        console.log("Cleanup error:", e);
    }
}

/* ===== ROUTE ===== */
router.get("/", async (req, res) => {
    let num = (req.query.number || "").replace(/[^0-9]/g, "");
    if (!num) return res.status(400).send({ code: "Number required" });

    const phone = pn("+" + num);
    if (!phone.isValid()) return res.status(400).send({ code: "Invalid number" });
    num = phone.getNumber("e164").replace("+", "");

    const dir = "./session" + num;
    rm(dir);

    async function start() {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            logger: pino({ level: "fatal" }),
            browser: Browsers.windows("Chrome"),
            printQRInTerminal: false,
            markOnlineOnConnect: false,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                try {
                    await delay(3000);

                    const credsPath = join(dir, 'creds.json');

                    const sessionInfo = await generateShortSession(credsPath);

                    if (!sessionInfo) {
                        throw new Error("Failed to generate session");
                    }

                    const jid = jidNormalizedUser(num + "@s.whatsapp.net");

                    const completeSession = `${sessionInfo.sessionId}${sessionInfo.encodedData}`;

                    await sock.sendMessage(jid, {
                        text: `${completeSession}`
                    });

                    await delay(2000);

                    const caption = `
╭━〔 *SYED-MD* 〕━··๏
┃★╭──────────────
┃★│ 👑 Owner : *SYED*
┃★│ 🤖 Baileys : *Multi Device*
┃★│ 💻 Type : *NodeJs*
┃★│ 🚀 Platform : *Railway*
┃★│ ⚙️ Mode : *Public*
┃★│ 🔣 Prefix : *[ . ]*
┃★│ 🏷️ Version : *8.0.0*
┃★╰──────────────
╰━━━━━━━━━━━━━━┈⊷`;

                    await sock.sendMessage(
                        jid,
                        {
                            text: caption
                        }
                    );

                    await delay(2000);
                    rm(dir);

                    setTimeout(() => {
                        process.exit(0);
                    }, 1000);

                } catch (err) {
                    console.error("❌ Error in pairing process:", err);
                    rm(dir);

                    try {
                        const jid = jidNormalizedUser(num + "@s.whatsapp.net");

                        await sock.sendMessage(jid, {
                            text: `❌ REAL ERROR:\n${err.message}`
                        });

                    } catch(e) {
                        console.log(e)
                    }

                    process.exit(1);
                }
            }

            if (connection === "close") {
                const c = lastDisconnect?.error?.output?.statusCode;

                if (c !== 401) {
                    setTimeout(() => start(), 2000);
                }
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(3000);

            try {
                let code = await sock.requestPairingCode(num);

                code = code?.match(/.{1,4}/g)?.join("-") || code;

                if (!res.headersSent) {
                    res.send({
                        success: true,
                        code: code,
                        message: "Scan QR code or use pairing code to connect"
                    });
                }

            } catch(err) {
                console.error("Pairing error:", err);

                if (!res.headersSent) {
                    res.status(503).send({
                        code: "PAIR_FAIL",
                        error: err.message
                    });
                }

                rm(dir);
                process.exit(1);
            }
        }
    }

    start();
});

process.on("uncaughtException", (err) => {
    console.error("Crash:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
});

export default router;
