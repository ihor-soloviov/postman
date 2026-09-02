"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} style={{ marginTop: 60 }}>
      <h1 style={{ margin: 0 }}>Поштар</h1>
      <p className="muted small" style={{ margin: 0 }}>Маршрути доставки та історія поїздок</p>
      {error && <div className="banner error">{error}</div>}
      <label className="field">
        <span>Пароль</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
      </label>
      <button className="primary btn-wide" disabled={busy}>
        {busy ? "Заходжу…" : "Увійти"}
      </button>
    </form>
  );
}
