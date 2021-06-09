import React from "react";
import ReactDOM from "react-dom";
import App from "../app/App";
import "./index.css";
import { RecoilRoot } from 'recoil';
import SnackbarProvider from 'react-simple-snackbar';

require('chrome-extension-async/chrome-extension-async');
require('chrome-extension-async/execute-async-function');

export var browser = require("webextension-polyfill");

ReactDOM.render(<RecoilRoot><SnackbarProvider><App /></SnackbarProvider></RecoilRoot>, document.querySelector("#root"));
