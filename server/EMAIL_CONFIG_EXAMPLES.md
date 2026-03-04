# Email Configuration Examples

Quick reference for configuring email notifications with Gmail and Outlook.

## Gmail Configuration

```env
# Enable email notifications
EMAIL_ENABLED=true

# Gmail SMTP Settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_work_email@gmail.com
SMTP_PASS=your_16_character_app_password
SMTP_SERVICE=gmail

# Email sender info
EMAIL_FROM=your_work_email@gmail.com
EMAIL_FROM_NAME=SPHAiRDigital

# App URL
APP_URL=http://localhost:3000

# Optional: direct email for "Contact Developer" (system owner); defaults to SMTP_USER
# FEEDBACK_EMAIL=your_direct_email@gmail.com
```

**Important for Gmail:**
- Must use **App Password** (not regular password)
- Enable 2-Factor Authentication first
- Generate App Password at: https://myaccount.google.com/apppasswords

---

## Outlook/Office 365 Configuration

### For Office 365 Work Accounts

```env
# Enable email notifications
EMAIL_ENABLED=true

# Office 365 SMTP Settings
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_work_email@company.com
SMTP_PASS=your_office365_password
SMTP_SERVICE=outlook

# Email sender info
EMAIL_FROM=your_work_email@company.com
EMAIL_FROM_NAME=SPHAiRDigital

# App URL
APP_URL=http://localhost:3000
```

### For Outlook.com Personal Accounts

```env
# Enable email notifications
EMAIL_ENABLED=true

# Outlook.com SMTP Settings
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@outlook.com
SMTP_PASS=your_password_or_app_password
SMTP_SERVICE=outlook

# Email sender info
EMAIL_FROM=your_email@outlook.com
EMAIL_FROM_NAME=SPHAiRDigital

# App URL
APP_URL=http://localhost:3000
```

---

## Quick Setup Checklist

- [ ] Choose your email provider (Gmail or Outlook)
- [ ] Copy the appropriate configuration above
- [ ] Update `SMTP_USER` with your work email
- [ ] Set `SMTP_PASS`:
  - **Gmail**: Generate App Password
  - **Outlook**: Use your password (or App Password if MFA enabled)
- [ ] Set `EMAIL_FROM` to match `SMTP_USER`
- [ ] Set `APP_URL` to your application URL
- [ ] Set `EMAIL_ENABLED=true`
- [ ] (Optional) Set `FEEDBACK_EMAIL` to the system owner's direct email for "Contact Developer" submissions
- [ ] Restart the server
- [ ] Test by assigning a task to a user

---

## Testing

After configuration, test by:
1. Assigning a task to a user with a valid email
2. Checking server logs for "Email sent successfully"
3. Checking the user's inbox (and spam folder)
