import React from "react";
import ReactDOM from "react-dom";
import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";
import App from "../app/App";
import "./index.css";
import { RecoilRoot } from 'recoil';
import SnackbarProvider from 'react-simple-snackbar';
import { browser } from '../static/globals';

Sentry.init({
    dsn: "https://315246baa1ed462883bab2ecd7507290@o975143.ingest.sentry.io/5931101",
    integrations: [new Integrations.BrowserTracing()],
    ignoreErrors: [
        'ResizeObserver loop limit exceeded',
    ],
    release: 'tabox-' + browser.runtime.getManifest().version,
    tracesSampleRate: 0.1,
});

ReactDOM.render(<RecoilRoot><SnackbarProvider><App /></SnackbarProvider></RecoilRoot>, document.querySelector("#root"));
