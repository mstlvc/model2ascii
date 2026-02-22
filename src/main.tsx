import React from "react";
import ReactDOM from "react-dom/client";
import Model2Ascii from "./components/Model2Ascii";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="relative min-h-screen">
      <Model2Ascii />
    </div>
  </React.StrictMode>
);
