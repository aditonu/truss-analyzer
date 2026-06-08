import React from 'react';
import ReactDOM from 'react-dom/client';

import ReactGA from 'react-ga4';      // ← ADD THIS LINE

// Initialize Google Analytics
ReactGA.initialize('G-Y5YBKHFTHP');   // ← ADD THIS LINE (replace with your ID)
ReactGA.send('pageview'); 

import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
