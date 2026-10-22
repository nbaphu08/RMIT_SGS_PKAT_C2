/**
 * Thu thập tên hiển thị sau khi đăng nhập lần đầu.
 *
 * Tide chỉ assert username (vuid) — không tên, không email. Trang "Update Account Information"
 * của Keycloak đã bị tắt ở bootstrap (scripts/tide/bootstrap.sh bước 2b), nên xin tên ở đây.
 *
 * Ba quy tắc, mỗi quy tắc tránh một lỗi thật:
 *  1. Ghi qua Account API bằng token CỦA CHÍNH NGƯỜI DÙNG, không dùng Admin API: Admin API cần
 *     credential admin trong app (AP-41), và trên realm bật IGA thì ghi kiểu admin trả 202 rồi
 *     nằm chờ approval — "Lưu" trông như thành công nhưng không đổi gì.
 *  2. Bỏ qua được. Tắt bức tường của Keycloak rồi dựng lại bức tường của mình thì vô nghĩa.
 *  3. Không bao giờ bịa email placeholder (AP-85).
 *
 * Keycloak không có attribute `displayName`: tên hiển thị lưu vào `firstName`.
 */

import { useEffect, useState } from "react";
import { useTideCloak } from "@tidecloak/react";

const DISMISS_KEY = "tide.profile-onboarding.dismissed";

export function ProfileOnboarding({ baseUrl, realm, required = false, onDone }) {
  const { authenticated, getValueFromToken, token } = useTideCloak();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authenticated) return;
    if (!required && localStorage.getItem(DISMISS_KEY) === "1") return;

    // getValueFromToken(key) — KHÔNG dùng tokenParsed: property đó không có trên context và trả
    // undefined lặng lẽ, modal sẽ không bao giờ hiện mà không báo lỗi.
    const hasName = getValueFromToken("given_name") || getValueFromToken("name");
    if (!hasName) {
      setDisplayName(getValueFromToken("given_name") || "");
      setOpen(true);
    }
  }, [authenticated, required, getValueFromToken]);

  if (!open) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
    onDone?.();
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/realms/${realm}/account/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: displayName.trim() }),
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error("Không có quyền cập nhật profile. Kiểm tra token có audience `account`.");
      }
      if (res.status === 202) {
        // Account API không nên trả 202. Nếu có thì IGA đã bắt lấy và đang chờ duyệt —
        // nói thật chứ không báo thành công khống.
        throw new Error("Thay đổi đang chờ admin duyệt, chưa được lưu.");
      }
      if (!res.ok) throw new Error(`Không lưu được (${res.status}).`);

      setOpen(false);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tide-onboarding-title"
      style={{
        position: "fixed", inset: 0, display: "grid", placeItems: "center",
        background: "rgba(0,0,0,.45)", zIndex: 1000, padding: "1rem",
      }}
    >
      <div style={{ background: "var(--card-bg, #fff)", color: "var(--card-fg, #111)",
                    borderRadius: 12, padding: "1.5rem", width: "min(28rem, 100%)" }}>
        <h2 id="tide-onboarding-title" style={{ margin: "0 0 .25rem", fontSize: "1.15rem" }}>
          Chào mừng tới Unreleased Studio
        </h2>
        <p style={{ margin: "0 0 1rem", opacity: .75, fontSize: ".9rem" }}>
          {required ? "Cần vài thông tin trước khi tiếp tục." : "Không bắt buộc — đặt sau cũng được."}
        </p>

        <label style={{ display: "block", marginBottom: ".75rem" }}>
          <span style={{ display: "block", fontSize: ".85rem", marginBottom: ".25rem" }}>
            Gọi bạn là gì?
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="given-name"
            style={{ width: "100%", padding: ".5rem .6rem", borderRadius: 6,
                     border: "1px solid var(--border, #ccc)", background: "transparent",
                     color: "inherit", boxSizing: "border-box" }}
          />
        </label>

        {error && (
          <p role="alert" style={{ color: "#c0392b", fontSize: ".85rem", margin: ".5rem 0" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: ".5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
          {!required && (
            <button type="button" onClick={dismiss} disabled={busy}
                    style={{ padding: ".5rem .9rem", borderRadius: 6, border: "1px solid var(--border,#ccc)",
                             background: "transparent", color: "inherit", cursor: "pointer" }}>
              Để sau
            </button>
          )}
          <button type="button" onClick={save} disabled={busy}
                  style={{ padding: ".5rem .9rem", borderRadius: 6, border: "none",
                           background: "var(--accent, #1f6feb)", color: "#fff", cursor: "pointer" }}>
            {busy ? "Đang lưu…" : "Lưu"}
          </button>
        </div>
      </div>
    </div>
  );
}
