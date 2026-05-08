@echo off
cd /d C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor
node -e "console.log('GATEWAY_TOKEN:', (process.env.OPENCLAW_GATEWAY_TOKEN || 'NOT_SET').substring(0,10) + '...'); console.log('GATEWAY_URL:', process.env.OPENCLAW_GATEWAY_URL || 'NOT_SET');" > env_check.txt 2>&1
echo Exit: %errorlevel%