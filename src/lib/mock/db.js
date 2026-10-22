// db.js — database + storage của server, giả lập cho Plan C. Đây là thứ Operator sửa được tùy ý
// (plan mục 3.5): papers, ciphertext, policy đã ký, nhận xét, lời mời.
//
// Để trong localStorage nên mọi tab cùng thấy: tác giả tải PDF lên ở tab này thì tab Operator
// thấy ngay ciphertext, giống server thật.

const KEY = "papersec.db.v1";

const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

// Seed theo plan mục 3.1: p1 còn hạn, p2 chưa chia sẻ, p3 đã hết hạn.
const INITIAL = {
  papers: {
    p1: { id: "p1", code_title: "Low-Resource ASR for Vietnamese Dialects", review_until: days(7), blob_size: null, updated_at: null },
    p2: { id: "p2", code_title: "Federated Learning on Hospital Imaging", review_until: null, blob_size: null, updated_at: null },
    p3: { id: "p3", code_title: "Quantum-Safe Voting Protocol", review_until: days(-1), blob_size: null, updated_at: null },
  },
  blobs: {},    // paperId -> ciphertext base64
  policies: {}, // `${record}:${paperId}` -> [{ subject_kind, subject, policy }]
  feedback: {}, // paperId -> [{ id, ciphertext, created_at }]
  invites: [],
  audit: [],
};

export function read() {
  try {
    return { ...structuredClone(INITIAL), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return structuredClone(INITIAL);
  }
}

export function write(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("papersec:db"));
}

export function update(fn) {
  const state = read();
  const result = fn(state);
  write(state);
  return result;
}

export function audit(state, actor, action, target, result) {
  state.audit = [
    { id: state.audit.length + 1, ts: new Date().toISOString(), actor, action, target, result },
    ...state.audit,
  ].slice(0, 200);
}

export function resetDb() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("papersec:db"));
}
