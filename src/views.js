// HTML for the billing app shell and the login / setup pages.
import { escHtml as e } from "./http.js";

const LOGO = "/static/catalog/omkar-industries-logo.png";

export function billingPage(base) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Billing | NEU-TECH</title>
  <link rel="icon" href="${LOGO}">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body data-base="${e(base)}">
  <header class="top">
    <a class="brand" href="#/"><img src="${LOGO}" alt=""><span>NEU-TECH <small>Billing</small></span></a>
    <nav>
      <a href="#/" data-nav="dashboard">Bills</a>
      <a href="#/new" data-nav="new">New Bill</a>
      <a href="#/products" data-nav="products">Products</a>
      <a href="#/clients" data-nav="clients">Clients</a>
      <a href="#/settings" data-nav="settings">Settings</a>
    </nav>
    <div class="top-right">
      <a href="/" target="_blank">View website</a>
      <a href="${e(base)}/logout">Log out</a>
    </div>
  </header>
  <main id="view"></main>
  <div id="toast" class="toast"></div>
  <datalist id="product-list"></datalist>
  <datalist id="client-list"></datalist>
  <script src="/static/app.js"></script>
</body>
</html>`;
}

/** mode: "login" | "setup". blocked: show the message only (no form). */
export function loginPage({ mode, error = "", blocked = false }) {
  const setup = mode === "setup";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${setup ? "Set up billing" : "Billing login"} | NEU-TECH</title>
  <link rel="icon" href="${LOGO}">
  <link rel="stylesheet" href="/static/style.css">
</head>
<body class="login-page">
  <form class="login-card" method="post">
    <img src="${LOGO}" alt="Omkar Industries" class="login-logo">
    ${setup
      ? `<h1>Set your billing password</h1>
         <p class="hint">This password protects your bills, clients and prices. Choose one only you know (at least 10 characters).</p>`
      : `<h1>Billing login</h1><p class="hint">Enter the admin password to open billing.</p>`}
    ${error ? `<p class="login-error">${e(error)}</p>` : ""}
    ${blocked ? "" : `
      <input type="text" name="username" value="admin" autocomplete="username" hidden>
      ${setup ? `<label>Setup code (the SETUP_CODE you set in Cloudflare)<input name="code" type="password" autocomplete="off" required autofocus></label>` : ""}
      <label>Password<input type="password" name="password" autocomplete="${setup ? "new-password" : "current-password"}" required ${setup ? "" : "autofocus"}></label>
      ${setup ? `<label>Confirm password<input type="password" name="password2" autocomplete="new-password" required></label>` : ""}
      <button class="primary" type="submit">${setup ? "Save and open billing" : "Log in"}</button>`}
    <a class="login-back" href="/">&larr; Back to website</a>
  </form>
</body>
</html>`;
}
