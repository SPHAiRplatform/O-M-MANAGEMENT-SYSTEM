# Email Notification Setup Guide

This guide explains how to configure email notifications for the SPHAiRDigital.

## Overview

The system sends email notifications as the **primary** notification method when users are assigned tasks. In-app notifications are sent as a secondary method.

The system supports **Gmail** and **Outlook/Office 365** email accounts.

## Email Configuration

Add the following environment variables to your `server/.env` file:

```env
# Enable email notifications
EMAIL_ENABLED=true

# SMTP Server Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_SERVICE=gmail

# Email Sender Information
EMAIL_FROM=your_email@gmail.com
EMAIL_FROM_NAME=SPHAiRDigital

# Application URL (for email links)
APP_URL=http://localhost:3000

# Contact Developer (feedback) - direct email for system owner
# Messages submitted via "Contact Developer" from companies are sent here
FEEDBACK_EMAIL=your_direct_email@example.com
```

**FEEDBACK_EMAIL**: Set this to the system owner's direct email. All submissions from the "Contact Developer" form (from any company) are sent to this address. If unset, feedback is sent to `SMTP_USER`.

---

## Gmail Setup (Recommended for Personal/Work Gmail Accounts)

### Step 1: Enable 2-Factor Authentication
1. Go to your [Google Account Security Settings](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (if not already enabled)

### Step 2: Generate App Password
1. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
2. Select **"Mail"** and **"Other (Custom name)"**
3. Enter **"SPHAiRDigital"** as the name
4. Click **"Generate"**
5. Copy the **16-character password** (use this as `SMTP_PASS`)

### Step 3: Update .env File
```env
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_work_email@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
SMTP_SERVICE=gmail
EMAIL_FROM=your_work_email@gmail.com
EMAIL_FROM_NAME=SPHAiRDigital
APP_URL=http://localhost:3000
```

**Note**: Remove spaces from the app password when pasting into `.env` file.

---

## Outlook/Office 365 Setup (Recommended for Work Emails)

### Option 1: Office 365 (Work/Enterprise Account)

#### Step 1: Get Your Office 365 Credentials
- Use your work email address (e.g., `yourname@company.com`)
- Use your regular Office 365 password (or app password if MFA is enabled)

#### Step 2: Update .env File
```env
EMAIL_ENABLED=true
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_work_email@company.com
SMTP_PASS=your_office365_password
SMTP_SERVICE=outlook
EMAIL_FROM=your_work_email@company.com
EMAIL_FROM_NAME=SPHAiRDigital
APP_URL=http://localhost:3000
```

### Option 2: Outlook.com (Personal Account)

#### Step 1: Enable App Passwords (if 2FA is enabled)
1. Go to [Microsoft Account Security](https://account.microsoft.com/security)
2. Enable **Two-step verification** (if not already enabled)
3. Go to **App passwords** section
4. Create a new app password for "Mail"
5. Copy the generated password

#### Step 2: Update .env File
```env
EMAIL_ENABLED=true
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@outlook.com
SMTP_PASS=your_app_password_or_regular_password
SMTP_SERVICE=outlook
EMAIL_FROM=your_email@outlook.com
EMAIL_FROM_NAME=SPHAiRDigital
APP_URL=http://localhost:3000
```

### Option 3: Outlook with Modern Authentication (MFA Required)

If your organization requires Modern Authentication:
1. Contact your IT administrator to create an **App Password** or **Service Account**
2. Use the app password in `SMTP_PASS`
3. Use the same SMTP settings as Option 1

### Quick Reference: Gmail vs Outlook

| Provider | SMTP Host | Port | Secure | Service Name |
|----------|-----------|------|--------|--------------|
| Gmail | `smtp.gmail.com` | 587 | false | `gmail` |
| Office 365 | `smtp.office365.com` | 587 | false | `outlook` |
| Outlook.com | `smtp-mail.outlook.com` | 587 | false | `outlook` |

### Custom SMTP Server
```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notifications@yourdomain.com
SMTP_PASS=your_password
# Leave SMTP_SERVICE empty for custom servers
```

## Testing Email Configuration

You can test your email configuration by:

1. **Enable email in .env**: Set `EMAIL_ENABLED=true`
2. **Create a test task**: Assign a task to a user with a valid email address
3. **Check server logs**: Look for "Email sent successfully" messages
4. **Check user's inbox**: The user should receive an email notification

## Email Notifications Sent

### Task Assignment Email
- **When**: Immediately when a task is assigned to a user
- **Subject**: "New Task Assigned: [Task Code]"
- **Content**: Task details, scheduled date, asset information, and link to view task

### Task Reminder Email
- **When**: 3 days before the scheduled task date
- **Subject**: "Task Reminder: [Task Code] - Due in 3 Days"
- **Content**: Reminder with task details and scheduled date

## Troubleshooting

### Email Not Sending
1. **Check EMAIL_ENABLED**: Must be set to `true`
2. **Verify SMTP credentials**: Ensure username and password are correct
3. **Check firewall**: Ensure SMTP port (587 or 465) is not blocked
4. **Check server logs**: Look for error messages in console

### Gmail "Less Secure App" Error
- Use **App Passwords** instead of regular password
- Enable **2-Factor Authentication** first
- Use the 16-character app password in `SMTP_PASS`
- **Never use your regular Gmail password** - it won't work

### Outlook Authentication Issues
- **Office 365**: If MFA is enabled, you may need an App Password from your IT admin
- **Outlook.com**: Enable App Passwords if 2FA is enabled
- **Connection timeout**: Try port 465 with `SMTP_SECURE=true` as alternative
- **Authentication failed**: Verify your email and password are correct

### Email Goes to Spam
- Ensure `EMAIL_FROM` matches your SMTP account
- Add SPF/DKIM records to your domain (for custom domains)
- Ask users to mark emails as "Not Spam"

## Disabling Email Notifications

To disable email notifications (use only in-app notifications):

```env
EMAIL_ENABLED=false
```

The system will continue to work normally, but will only send in-app notifications.

## Security Notes

- **Never commit `.env` file** to version control
- **Use App Passwords** instead of main account passwords
- **Rotate passwords** regularly
- **Use environment-specific credentials** for production vs development
