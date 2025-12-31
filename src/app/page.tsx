"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Mic, PhoneCall, PhoneOff, Waves } from "lucide-react";

type PeerModule = typeof import("peerjs");

type CallStatus =
  | "initializing"
  | "ready"
  | "calling"
  | "in-call"
  | "incoming"
  | "error";

const AGENT_PREFIX = "agentic";

type ExtendedWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const createAgentId = () => {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return `${AGENT_PREFIX}-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
};

export default function Home() {
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<import("peerjs").Peer | null>(null);
  const callRef = useRef<import("peerjs").MediaConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [localId, setLocalId] = useState<string>("");
  const [remoteId, setRemoteId] = useState<string>("");
  const [status, setStatus] = useState<CallStatus>("initializing");
  const [statusMessage, setStatusMessage] = useState<string>("Loading agent…");
  const [isCopying, setIsCopying] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "ready":
        return "Ready";
      case "calling":
        return "Dialing…";
      case "incoming":
        return "Incoming Call";
      case "in-call":
        return "Live";
      case "error":
        return "Error";
      default:
        return "Starting…";
    }
  }, [status]);

  const updateStatus = useCallback(
    (nextStatus: CallStatus, message: string) => {
      setStatus(nextStatus);
      setStatusMessage(message);
    },
    [],
  );

  const destroyCall = useCallback(() => {
    callRef.current?.close();
    callRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      localStreamRef.current = stream;

      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      if (!audioContextRef.current) {
        const AudioContextCtor =
          window.AudioContext ||
          (window as ExtendedWindow).webkitAudioContext;
        if (!AudioContextCtor) {
          throw new Error("AudioContext is not supported in this browser.");
        }
        audioContextRef.current = new AudioContextCtor();
      }

      const context = audioContextRef.current;
      if (!context) {
        throw new Error("Failed to initialize audio context.");
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;

      return stream;
    } catch (error) {
      updateStatus(
        "error",
        error instanceof Error
          ? error.message
          : "Microphone access was denied.",
      );
      throw error;
    }
  }, [updateStatus]);

  const observeMicLevel = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const volume = data.reduce((acc, value) => acc + value, 0) / data.length;
      setMicLevel(Math.round(volume));
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    tick();
  }, []);

  const registerCallHandlers = useCallback(
    (call: import("peerjs").MediaConnection) => {
      callRef.current?.close();
      callRef.current = call;

      call.on("stream", (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
        updateStatus("in-call", `Connected with ${call.peer}.`);
      });

      call.on("close", () => {
        updateStatus("ready", "Call ended.");
        destroyCall();
      });

      call.on("error", (error) => {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Call error occurred.",
        );
        destroyCall();
      });
    },
    [destroyCall, updateStatus],
  );

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const peerJs: PeerModule = await import("peerjs");
      const peer = new peerJs.Peer(createAgentId(), {
        debug: 0,
      });
      peerRef.current = peer;

      peer.on("open", (id) => {
        if (!isMounted) return;
        setLocalId(id);
        updateStatus("ready", "Share your agent ID or dial a peer to connect.");
      });

      peer.on("call", async (incomingCall) => {
        updateStatus("incoming", `Call incoming from ${incomingCall.peer}.`);
        try {
          const stream = await ensureLocalStream();
          observeMicLevel();
          incomingCall.answer(stream);
          registerCallHandlers(incomingCall);
        } catch (error) {
          updateStatus(
            "error",
            error instanceof Error
              ? error.message
              : "Unable to answer incoming call.",
          );
        }
      });

      peer.on("disconnected", () => {
        updateStatus("error", "Connection lost. Attempting to reconnect…");
        peer.reconnect();
      });

      peer.on("error", (error) => {
        updateStatus(
          "error",
          error instanceof Error ? error.message : "Unexpected peer error.",
        );
      });
    })();

    return () => {
      isMounted = false;
      destroyCall();
      peerRef.current?.destroy();
      peerRef.current = null;
    };
  }, [destroyCall, ensureLocalStream, observeMicLevel, registerCallHandlers, updateStatus]);

  const placeCall = useCallback(async () => {
    if (!remoteId.trim()) {
      updateStatus("error", "Enter a peer ID before calling.");
      return;
    }
    if (!peerRef.current) {
      updateStatus("error", "Agent not ready yet.");
      return;
    }
    try {
      const stream = await ensureLocalStream();
      observeMicLevel();
      updateStatus("calling", `Calling ${remoteId}…`);
      const call = peerRef.current.call(remoteId.trim(), stream);
      registerCallHandlers(call);
    } catch (error) {
      updateStatus(
        "error",
        error instanceof Error ? error.message : "Failed to start call.",
      );
    }
  }, [ensureLocalStream, observeMicLevel, registerCallHandlers, remoteId, updateStatus]);

  const endCall = useCallback(() => {
    callRef.current?.close();
    callRef.current = null;
    destroyCall();
    updateStatus("ready", "Call ended.");
  }, [destroyCall, updateStatus]);

  const handleCopyId = useCallback(async () => {
    if (!localId) return;
    try {
      await navigator.clipboard.writeText(localId);
      setIsCopying(true);
      setTimeout(() => setIsCopying(false), 1200);
    } catch (error) {
      updateStatus(
        "error",
        error instanceof Error
          ? error.message
          : "Unable to copy ID to clipboard.",
      );
    }
  }, [localId, updateStatus]);

  const isCallActive = status === "calling" || status === "in-call";
  const isReady = status === "ready" || status === "incoming";

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-16 sm:px-10 lg:px-16">
        <header className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-[0.35em] text-slate-400">
            Agentic Voice Mesh
          </span>
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Turn any browser into a live voice calling agent.
          </h1>
          <p className="max-w-2xl text-base text-slate-300 sm:text-lg">
            Share your agent ID with another browser session to establish a
            secure, peer-to-peer audio bridge. No installs. No accounts. Just a
            microphone and the web.
          </p>
        </header>

        <section className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <article className="flex flex-col gap-8 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-md sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/40 px-5 py-4">
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wider text-slate-400">
                  Your agent ID
                </span>
                <span className="font-mono text-lg text-emerald-300 sm:text-xl">
                  {localId || "initializing…"}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!localId}
              >
                {isCopying ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label
                htmlFor="remote-id"
                className="text-xs uppercase tracking-wider text-slate-400"
              >
                Dial a peer
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="remote-id"
                  value={remoteId}
                  onChange={(event) => setRemoteId(event.target.value)}
                  placeholder="agentic-xxxx-xxxx"
                  className="h-12 flex-1 rounded-full border border-slate-500/40 bg-black/40 px-5 font-mono text-sm text-slate-100 outline-none transition focus:border-emerald-400/60"
                />
                <button
                  type="button"
                  onClick={placeCall}
                  disabled={!isReady || !remoteId.trim()}
                  className="flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PhoneCall className="h-4 w-4" />
                  Call
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs uppercase tracking-wider text-slate-400">
                Call status
              </span>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                    <Waves className="h-5 w-5 text-emerald-300" />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold uppercase tracking-widest text-emerald-300">
                      {statusLabel}
                    </span>
                    <span className="text-sm text-slate-300">
                      {statusMessage}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={endCall}
                  disabled={!isCallActive}
                  className="flex h-10 items-center justify-center gap-2 rounded-full border border-red-400/40 bg-red-500/10 px-4 text-xs font-semibold uppercase tracking-widest text-red-300 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <PhoneOff className="h-4 w-4" />
                  Hang Up
                </button>
              </div>
            </div>

            <div className="grid gap-6 rounded-2xl border border-white/5 bg-black/30 p-6 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <span className="text-xs uppercase tracking-wider text-slate-400">
                  Local microphone
                </span>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                    <Mic className="h-5 w-5 text-emerald-300" />
                  </span>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-all"
                        style={{ width: `${Math.min(micLevel / 1.5, 100)}%` }}
                      />
                    </div>
                    <span className="mt-2 block text-xs text-slate-400">
                      {micLevel > 0
                        ? `Mic activity ${Math.min(
                            Math.round(micLevel / 1.5),
                            100,
                          )}%`
                        : "Mic idle"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-xs uppercase tracking-wider text-slate-400">
                  Connection tips
                </span>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>Use a second browser window or device to simulate a peer.</li>
                  <li>Both peers must keep the tab open to stay connected.</li>
                  <li>Ensure microphone permissions are granted when prompted.</li>
                </ul>
              </div>
            </div>

            <audio ref={localAudioRef} autoPlay muted playsInline className="hidden" />
            <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
          </article>

          <aside className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/60 via-slate-900/20 to-transparent p-6 backdrop-blur-md sm:p-8">
            <h2 className="text-2xl font-semibold text-white">
              Agentic Playbook
            </h2>
            <div className="space-y-5 text-sm leading-6 text-slate-300">
              <p>
                The voice agent uses WebRTC through PeerJS’ mesh network to
                deliver encrypted, low-latency audio. Sharing your agent ID
                allows another peer to discover and call you directly in the
                browser.
              </p>
              <p>
                When you press call, the agent dials the remote ID and bridges
                microphone streams end-to-end. Incoming calls auto-answer so you
                can prototype workflows like concierge bots, escalation bridges,
                or voice-first assistants.
              </p>
              <p>
                Extend this foundation with speech recognition, LLM copilots, or
                CRM integrations to orchestrate fully autonomous call flows that
                run anywhere the web can go.
              </p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}
