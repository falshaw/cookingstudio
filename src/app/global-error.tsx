"use client";

// Replaces the root layout when the layout itself throws, so it cannot rely on
// globals.css or the font variables — literal theme values, inline.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07060f",
          color: "#f4f1ff",
          fontFamily: '"Segoe UI", system-ui, sans-serif',
        }}
      >
        <div
          style={{
            background: "#110e20",
            border: "1px solid #e6decf",
            borderRadius: 18,
            padding: 32,
            maxWidth: 420,
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 22, margin: 0 }}>CookingStudio could not start this page</h1>
          <p style={{ fontSize: 14, color: "#a39dbd", marginTop: 8 }}>
            Your data is untouched. Try again; the app log has the details.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#a39dbd", fontFamily: "monospace" }}>
              ref {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "10px 22px",
              borderRadius: 9999,
              border: "none",
              background: "#ff4fd8",
              color: "#110e20",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <p style={{ fontSize: 11, color: "#a39dbd", marginTop: 16 }}>Not medical advice, check with your doctor.</p>
        </div>
      </body>
    </html>
  );
}
