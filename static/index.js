import React from "react";
import { createRoot } from "react-dom/client";
import App from "../app/App";
import { ToastViewport } from '../app/ToastViewport';
import "./index.css";
import { Provider } from 'jotai';

const root = createRoot(document.querySelector("#root"));
root.render(
  <Provider>
    <App />
    <ToastViewport context="popup" />
  </Provider>
);
