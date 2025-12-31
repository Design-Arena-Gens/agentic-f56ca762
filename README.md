## Agentic Voice Mesh

Agentic Voice Mesh is a browser-native voice calling agent built with Next.js, Tailwind CSS, and PeerJS. Spin up the app, share your generated agent ID with another browser session, and establish an encrypted WebRTC audio bridge—no installs or accounts required.

### Features

- Peer-to-peer audio calls powered by PeerJS’ hosted mesh network
- Auto-answering agent flow for instant inbound bridging
- Real-time microphone level visualizer with echo cancellation + noise suppression
- Responsive, glassmorphism-inspired UI ready for Vercel deployment

### Local Development

```bash
npm install
npm run dev
```

Visit http://localhost:3000 in two separate browser windows or devices. Copy the displayed agent ID from the first window, paste it into the “Dial a peer” input on the second, then press **Call** to establish a live audio channel.

### Production Build

```bash
npm run build
npm run start
```

### Environment & Deployment

No environment variables are required for local development. The application deploys cleanly to Vercel (`npm run build && npm run start`). After deployment, verify the production instance by calling https://agentic-f56ca762.vercel.app.

Extend the agent by layering in transcription, LLM orchestration, or CRM/webhook integrations to craft fully autonomous voice experiences.
