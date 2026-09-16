import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { playChime, setSoundEnabled, soundEnabled } from "./chime";
import { connectCommands, maskToken } from "./connect";
import { AGENT_LABEL } from "./Chat";

type SettingsAgent = {
  id: string;
  label: string;
  loggedIn: boolean | null;
  detail: string | null;
};

type Props = {
  // The agents installed on this Mac, so signing in lives with the rest of the
  // setup rather than beside the parts.
  agents: SettingsAgent[];
  agentStatusState: "loading" | "ready" | "error";
  signingIn: string | null;
  // The local endpoint an assistant on this Mac connects to, once it is up.
  serve: { url: string; port: number; token: string } | null;
  onSignIn: (id: string) => Promise<boolean>;
  onMoreAgents: () => void;
  onClose: () => void;
};

export default function Settings({
  agents,
  agentStatusState,
  signingIn,
  serve,
  onSignIn,
  onMoreAgents,
  onClose,
}: Props) {
  const [sound, setSound] = useState(soundEnabled);
  // The rail's error line is behind this modal, so a failed sign-in reports here.
  const [signInError, setSignInError] = useState<string | null>(null);
  // One key per copyable row, so only the row you pressed says so.
  const [copied, setCopied] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // One object so the rows read from a single non-null value.
  const connect = serve ? { ...connectCommands(serve), token: serve.token } : null;

  const copy = (key: string, text: string) => {
    writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    });
  };

  // A call rather than a component, so pressing it does not remount the button.
  const copyButton = (name: string, text: string) => (
    <button className="settings-action" aria-live="polite" onClick={() => copy(name, text)}>
      {copied === name ? "Copied" : "Copy"}
    </button>
  );

  const toggleSound = (on: boolean) => {
    setSoundEnabled(on);
    setSound(on);
    // Turning it on plays the chime once, so the choice is audible in place.
    if (on) playChime();
  };

  return (
    <div className="about" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="about-card settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button className="about-close" title="close" onClick={onClose}>
          ×
        </button>
        <div className="about-title" id="settings-title">
          Settings
        </div>
        <div className="about-body">
          <h3>Sound</h3>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => toggleSound(e.target.checked)}
            />
            Play a chime when the agent finishes a long task
          </label>
          <h3>Agents</h3>
          <p>Pick which one you chat with from the chat header.</p>
          {agentStatusState === "loading" && (
            <p className="settings-agent-state" role="status">checking agent status…</p>
          )}
          {agentStatusState === "error" && (
            <p className="settings-agent-error" role="alert">couldn’t check agent status</p>
          )}
          {agentStatusState === "ready" && (
            <>
              {agents.map((agent) => (
                <div className="settings-agent" key={agent.id}>
                  <span className="settings-agent-name">
                    {AGENT_LABEL[agent.id] ?? agent.label}
                  </span>
                  {agent.loggedIn === false ? (
                    <button
                      className="settings-action"
                      disabled={signingIn !== null}
                      onClick={() => {
                        setSignInError(null);
                        onSignIn(agent.id).catch((e) => setSignInError(String(e)));
                      }}
                    >
                      {signingIn === agent.id ? "signing in…" : "sign in"}
                    </button>
                  ) : (
                    <span className="settings-agent-state" title={agent.detail ?? undefined}>
                      {agent.loggedIn ? "signed in" : "status unknown"}
                    </span>
                  )}
                </div>
              ))}
              <button className="settings-agent-more" onClick={onMoreAgents}>
                need another agent?
              </button>
            </>
          )}
          {signInError && <p className="settings-agent-error" role="alert">{signInError}</p>}
          <h3>Connect</h3>
          <p>
            Let a coding assistant on this Mac work on your parts. Paste one of the commands
            below into it and it can build, check and export the parts in your projects.
          </p>
          {!connect ? (
            <p className="settings-soon">Starting the engine</p>
          ) : (
            <>
              <div className="connect-row">
                <span className="connect-label">Address</span>
                <span className="connect-value">{connect.mcpUrl}</span>
                {copyButton("address", connect.mcpUrl)}
              </div>
              <div className="connect-row">
                <span className="connect-label">Token</span>
                <span className="connect-value connect-token">
                  {revealed ? connect.token : maskToken(connect.token)}
                </span>
                <button className="settings-action" onClick={() => setRevealed(!revealed)}>
                  {revealed ? "Hide" : "Reveal"}
                </button>
                {copyButton("token", connect.token)}
              </div>
              <h3>Commands</h3>
              <div className="settings-agent connect-command">
                <span className="settings-agent-name connect-client">Claude Code</span>
                <code className="connect-code">{connect.claudeCode}</code>
                {copyButton("claude", connect.claudeCode)}
              </div>
              <div className="settings-agent connect-command">
                <span className="settings-agent-name connect-client">Codex CLI</span>
                <code className="connect-code">{connect.codexCli}</code>
                {copyButton("codex", connect.codexCli)}
              </div>
              <div className="settings-agent connect-command connect-command-last">
                <span className="settings-agent-name connect-client">Cursor</span>
                <code className="connect-code">{connect.cursorConfig}</code>
                <button
                  className="settings-action"
                  onClick={() => openUrl(connect.cursorLink).catch(() => {})}
                >
                  Add to Cursor
                </button>
                {copyButton("cursor", connect.cursorConfig)}
              </div>
              <p className="settings-soon">Keep nurb open while you use it</p>
            </>
          )}
          <h3>nurb.app</h3>
          <p>Sign in to publish parts and back up projects.</p>
          <div className="settings-actions">
            <button
              className="settings-action settings-action-dead"
              disabled
              aria-disabled="true"
              title="Accounts are not open yet"
            >
              Sign in
            </button>
          </div>
          <p className="settings-soon">Coming soon</p>
        </div>
      </div>
    </div>
  );
}
