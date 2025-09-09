# P2P Voice Chat

A minimal peer-to-peer voice chat web application built with Next.js and WebRTC. No server infrastructure required - users connect directly to each other!

## Features

- 🎤 Direct P2P voice communication using WebRTC
- 🚀 No server infrastructure needed
- 💻 Works in modern browsers
- 📱 Mobile-friendly responsive design
- 🔒 Secure peer-to-peer connections

## How It Works

1. **Start Voice Chat**: Click the button and allow microphone access
2. **Create/Join Room**: Enter a room ID (e.g., "room123") and click "Join Room"
3. **Share Room ID**: Tell your friend the same room ID
4. **Connect**: Your friend joins the same room ID from their device
5. **Chat**: You're now connected directly via P2P!

## Technical Details

- Built with Next.js 14 and TypeScript
- Uses WebRTC for peer-to-peer audio streaming
- Simple signaling mechanism using localStorage and storage events
- Deployed on Vercel with zero server costs
- STUN servers for NAT traversal

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Deployment

This app is designed to be deployed on Vercel:

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Deploy automatically

The app works entirely client-side with no server requirements!

## Browser Support

- Chrome/Chromium (recommended)
- Firefox
- Safari (with some limitations)
- Edge

Requires HTTPS for microphone access in production.
