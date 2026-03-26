import React from "react";
import { createRoot } from "react-dom/client";
import App from "../app/App";
import "./index.css";
import "./fullpage.css";
import { Provider } from 'jotai';
import { Toaster } from 'react-hot-toast';

const root = createRoot(document.querySelector("#root"));
root.render(
  <Provider>
    <App mode="fullpage" />
    <Toaster
      position="bottom-right"
      containerStyle={{ bottom: 24, right: 24 }}
      toastOptions={{
        style: { background: 'transparent', boxShadow: 'none', padding: 0 },
      }}
    />
  </Provider>
);
