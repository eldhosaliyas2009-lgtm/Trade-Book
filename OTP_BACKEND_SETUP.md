# TradeBook 6-Digit OTP Backend

This build uses Firebase callable Cloud Functions + Resend for custom 6-digit OTP verification.

## OTP scope in this build
- Forgot Password
- Change Password
- Delete Account

Login and Create Account are NOT converted to OTP in this build. Create Account continues to use Firebase email-verification link.

## Flow
1. The backend generates a fresh random 6-digit code for every request.
2. Only a SHA-256 hash of the code is stored in Firestore.
3. The code is sent to the user's registered email through Resend.
4. The user enters the code in TradeBook.
5. The backend verifies the code, expiry, and attempt count.
6. A successful verification deletes the active challenge so the code cannot be reused.
7. Resend creates a new code and invalidates the previous one.

## Firebase setup
1. Enable Cloud Firestore.
2. Enable Email/Password in Firebase Authentication.
3. Create/configure a Cloud Billing account and Blaze plan if Firebase requires it for Cloud Functions deployment.
4. Set the Resend secret (never put it in app.js):

```bash
firebase functions:secrets:set RESEND_API_KEY
```

5. Deploy:

```bash
firebase deploy --only functions
```

The frontend calls `requestAuthOtp` and `verifyAuthOtp` in the deployed `asia-south1` functions.

## Resend sender
The current code uses `TradeBook <onboarding@resend.dev>`. For production sending to arbitrary registered email addresses, use a verified sending domain/address in Resend and update the `from` value in `functions/index.js`.

## Security
- Never put the Resend API key in the frontend.
- OTPs are random, 6 digits, expire after 10 minutes, and are limited to 5 incorrect attempts.
- A successful OTP is deleted immediately.
- Resend replaces the previous OTP.
