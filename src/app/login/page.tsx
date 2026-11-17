"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Eye, EyeOff, LogIn, LoaderCircle } from "lucide-react";
import "./login-neon.css";
import { MedicalFooter } from "@/components/MedicalFooter";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Login failed");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lg">
      <div className="lg-film" aria-hidden>
      </div>
      <div className="lg-bar t" aria-hidden />
      <div className="lg-bar b" aria-hidden />
      <div className="lg-sparks" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /></div>

      <section className="lg-left">
        <div className="neon-lanterns lg-lanterns" aria-hidden><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <p className="neon-sign lg-sign">CookingStudio</p>
        <span className="lg-open">Kitchen open</span>
        <p className="lg-tag">Cook it once, then cook it better. Step by step, sauces from scratch, one shopping list by aisle.</p>
      </section>

      <main className="lg-right">
        <form onSubmit={submit} className="lg-card">
          <h1>Sign in</h1>
          <p className="sub">Welcome back to the kitchen</p>

          {error && <div className="lg-err" role="alert">{error}</div>}

          <label className="lg-field">
            <Mail className="ic" />
            <input type="email" required autoFocus autoComplete="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <label className="lg-field">
            <Lock className="ic" />
            <input type={show ? "text" : "password"} required autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow((v) => !v)} className="lg-eye" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </label>

          <button type="submit" disabled={loading} className="lg-go">
            {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <><LogIn className="h-[18px] w-[18px]" /> Sign in</>}
          </button>
        </form>
      </main>
      <div className="lg-foot"><MedicalFooter className="border-0" /></div>
    </div>
  );
}
