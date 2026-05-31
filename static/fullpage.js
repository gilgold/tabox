import React from "react";
import { createRoot } from "react-dom/client";
import App from "../app/App";
import { ToastViewport } from '../app/ToastViewport';
import "./index.css";
import "./fullpage.css";
import { Provider } from 'jotai';

const root = createRoot(document.querySelector("#root"));
root.render(
  <Provider>
    <App mode="fullpage" />
    <ToastViewport context="fullpage" />
  </Provider>
);
