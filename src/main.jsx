import React from "react";
import { createRoot } from "react-dom/client";
import { TideCloakContextProvider } from "@tidecloak/react";
import App from "./App.jsx";
import "./style.css";

// useDPoP nằm TRONG config, không phải prop riêng. Provider tự tải tidecloak.json
// (A sinh ra, ngoài git) rồi trộn các tùy chọn này lên trên.
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TideCloakContextProvider
      configUrl="/tidecloak.json"
      config={{ useDPoP: { mode: "strict", alg: "ES256" } }}
    >
      <App />
    </TideCloakContextProvider>
  </React.StrictMode>,
);
