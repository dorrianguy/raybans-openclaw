@echo off
title EAS iOS Build - Ray-Bans Companion
echo ==============================================
echo  EAS iOS Build - Ray-Bans Companion
echo ==============================================
echo.
echo This will build the iOS IPA for Sideloadly.
echo.
echo You will be asked: "Do you want to log in to your Apple account?"
echo Type "y" and press Enter, then sign in with: dorrianguy@yahoo.com
echo.
echo After signing in, EAS handles everything automatically.
echo Build takes ~15-20 minutes on Expo's cloud servers.
echo.
pause

set EXPO_TOKEN=YXsQyqsPwIdU5wC-ZhkbNcBn68GkW4vZ5bAvQZwL
cd /d "C:\Users\chad420\.openclaw\workspace\raybans-openclaw\companion-app"

eas build --platform ios --profile preview

echo.
echo ==============================================
echo Build submitted! Check https://expo.dev/accounts/dorrianguy/projects/raybans-companion/builds
echo ==============================================
pause
