const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

if (!getApps().length) initializeApp();

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const OTP_COLLECTION = "tradebookOtpChallenges";
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function makeOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validAction(action) {
  return ["forgot-password", "change-password", "delete-account"].includes(action);
}

function otpDocId(uid, action) {
  return `${uid}_${action}`;
}

exports.requestAuthOtp = onCall(
  { secrets: [RESEND_API_KEY], region: "asia-south1" },
  async (request) => {
    const action = String(request.data?.action || "");
    const email = normalizeEmail(request.data?.email);

    if (!validAction(action)) {
      throw new HttpsError("invalid-argument", "Invalid OTP action.");
    }
    if (!email) {
      throw new HttpsError("invalid-argument", "Email is required.");
    }

    const user = await getAuth().getUserByEmail(email).catch(() => null);
    if (!user) {
      throw new HttpsError("not-found", "No TradeBook account was found for this email.");
    }

    if (action !== "forgot-password" && !request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    if (action !== "forgot-password" && request.auth.uid !== user.uid) {
      throw new HttpsError("permission-denied", "This account does not match the signed-in user.");
    }

    const db = getFirestore();
    const ref = db.collection(OTP_COLLECTION).doc(otpDocId(user.uid, action));
    const existing = await ref.get();
    if (existing.exists) {
      const previous = existing.data() || {};
      const resendAvailableAt = Number(previous.resendAvailableAt || 0);
      if (Date.now() < resendAvailableAt) {
        const waitSeconds = Math.ceil((resendAvailableAt - Date.now()) / 1000);
        throw new HttpsError("resource-exhausted", `Please wait ${waitSeconds} seconds before requesting another code.`);
      }
    }

    const code = makeOtp();
    const now = Date.now();
    await ref.set({
      uid: user.uid,
      action,
      codeHash: hashOtp(code),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: now + OTP_TTL_MS,
      resendAvailableAt: now + RESEND_COOLDOWN_MS,
      attempts: 0
    });

    const subject = action === "delete-account"
      ? "TradeBook account deletion verification code"
      : action === "change-password"
        ? "TradeBook password change verification code"
        : "TradeBook password reset verification code";

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY.value()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "TradeBook <onboarding@resend.dev>",
        to: [email],
        subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>TradeBook verification code</h2><p>Your 6-digit verification code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes.</p><p>If you requested a new code, only the latest code is valid.</p><p>If you did not request this, you can safely ignore this email.</p></div>`
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("Resend error:", body);
      // Do not leave a challenge active when the email provider failed.
      await ref.delete().catch(() => {});
      throw new HttpsError("internal", "Unable to send the verification email.");
    }

    return { sent: true, expiresIn: OTP_TTL_MS / 1000, resendAfter: RESEND_COOLDOWN_MS / 1000 };
  }
);

exports.verifyAuthOtp = onCall(
  { region: "asia-south1" },
  async (request) => {
    const action = String(request.data?.action || "");
    const code = String(request.data?.code || "").replace(/\D/g, "");

    if (!validAction(action) || !/^\d{6}$/.test(code)) {
      throw new HttpsError("invalid-argument", "Enter a valid 6-digit verification code.");
    }

    const db = getFirestore();
    let uid = request.auth?.uid || null;

    if (!uid && action === "forgot-password") {
      const email = normalizeEmail(request.data?.context?.email);
      if (!email) {
        throw new HttpsError("invalid-argument", "Email is required.");
      }
      const user = await getAuth().getUserByEmail(email).catch(() => null);
      if (!user) {
        throw new HttpsError("not-found", "No TradeBook account was found for this email.");
      }
      uid = user.uid;
    }

    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const ref = db.collection(OTP_COLLECTION).doc(otpDocId(uid, action));
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", "No verification code is active. Request a new code.");
    }

    const data = snap.data() || {};
    if (Date.now() > Number(data.expiresAt || 0)) {
      await ref.delete();
      throw new HttpsError("deadline-exceeded", "The verification code has expired. Request a new code.");
    }

    const attempts = Number(data.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) {
      await ref.delete();
      throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Request a new code.");
    }

    if (hashOtp(code) !== data.codeHash) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_ATTEMPTS) {
        await ref.delete();
        throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Request a new code.");
      }
      await ref.update({ attempts: nextAttempts });
      throw new HttpsError("invalid-argument", "Incorrect verification code.");
    }

    // One-time use: delete immediately after a successful match.
    await ref.delete();

    if (action === "forgot-password") {
      const customToken = await getAuth().createCustomToken(uid);
      return { verified: true, customToken };
    }

    if (action === "delete-account") {
      // Delete through Admin SDK after the OTP is verified. This avoids the
      // client-side Firebase "requires-recent-login" limitation and makes
      // the OTP the final verification step for account deletion.
      await getAuth().deleteUser(uid);
      return { verified: true, deleted: true };
    }

    return { verified: true };
  }
);
