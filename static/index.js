import React from "react";
import ReactDOM from "react-dom";
import App from "../app/App";
import "./index.css";
import { RecoilRoot } from 'recoil';
import SnackbarProvider from 'react-simple-snackbar';

ReactDOM.render(<RecoilRoot><SnackbarProvider><App /></SnackbarProvider></RecoilRoot>, document.querySelector("#root"));
