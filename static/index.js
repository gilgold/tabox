import React from "react";
import ReactDOM from "react-dom";
import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";
import App from "../app/App";
import "./index.css";
import { RecoilRoot } from 'recoil';
import SnackbarProvider from 'react-simple-snackbar';

export var browser = require("webextension-polyfill");

Sentry.init({
    dsn: "https://315246baa1ed462883bab2ecd7507290@o975143.ingest.sentry.io/5931101",
    integrations: [new Integrations.BrowserTracing()],
    release: 'tabox-' + browser.runtime.getManifest().version,
    tracesSampleRate: 1.0,
});

require('chrome-extension-async/chrome-extension-async');
require('chrome-extension-async/execute-async-function');

ReactDOM.render(<RecoilRoot><SnackbarProvider><App /></SnackbarProvider></RecoilRoot>, document.querySelector("#root"));
