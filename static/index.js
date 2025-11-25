import React from "react";
import { createRoot } from "react-dom/client";
import App from "../app/App";
import "./index.css";
import { Provider } from 'jotai';
import { Toaster } from 'react-hot-toast';

const root = createRoot(document.querySelector("#root"));
root.render(
  <Provider>
    <App />
    <Toaster 
      position="bottom-center"
      toastOptions={{
        duration: 3000,
        style: {
          background: '#363636',
          color: '#fff',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '14px',
        },
        success: {
          duration: 3000,
          iconTheme: {
            primary: '#4caf50',
            secondary: '#fff',
          },
        },
        error: {
          duration: 4000,
          iconTheme: {
            primary: '#f44336',
            secondary: '#fff',
          },
        },
      }}
    />
  </Provider>
);
