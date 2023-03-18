import { WebOAuthServer } from '@salesforce/core';
import { Builder, Browser, By } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome.js';
import express from 'express';
import * as dotenv from 'dotenv';

// Resources
// https://cloud.google.com/run/docs/configuring/static-outbound-ip
// https://github.com/forcedotcom/sfdx-core/blob/main/src/webOAuthServer.ts
// https://github.com/forcedotcom/sfdx-core/blob/main/src/org/authInfo.ts

dotenv.config();

const app = express();

app.use(express.json());

app.get('/sfdxauthurl', async (req, res) => {
  let username, password, domain;

  if ('username' in req.query) {
    username = req.query.username;
  } else if ('SF_USERNAME' in process.env) {
    username = process.env.SF_USERNAME;
  } else {
    sendFailure(res, 400, 'Missing username.');
    return;
  }

  if ('password' in req.query) {
    password = req.query.password;
  } else if ('SF_PASSWORD' in process.env) {
    password = process.env.SF_PASSWORD;
  } else {
    sendFailure(res, 400, 'Missing password.');
    return;
  }

  if ('domain' in req.query) {
    domain = req.query.domain;
  } else if ('SF_DOMAIN' in process.env) {
    domain = process.env.SF_DOMAIN;
  } else {
    sendFailure(res, 400, 'Missing domain.');
    return;
  }

  // Prepare Selenium Chrome driver.
  const chromeOptions = new Options().headless();
  chromeOptions.addArguments('--no-sandbox');
  chromeOptions.addArguments('--disable-dev-shm-usage');

  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(chromeOptions)
    .build();

  try {
    // Start the Salesforce OAuth Server to receive the OAuth response.
    const oauthServer = await WebOAuthServer.create({
      oauthConfig: {
        loginUrl: 'https://' + domain
      }
    });

    // Navigate to the OAuth authorization URL
    const authUrl = oauthServer.getAuthorizationUrl();
    await driver.get(authUrl);

    // Enter the username, password and click login.
    await driver.findElement(By.id('username')).sendKeys(username);
    await driver.findElement(By.id('password')).sendKeys(password);

    await driver.findElement(By.id('Login')).click();

    // Receive the OAuth response and get the authInfo object.
    const authInfo = await oauthServer.authorizeAndSave();

    const sfdxAuthUrl = authInfo.getSfdxAuthUrl();

    sendSuccess(res, sfdxAuthUrl);
  } catch (error) {
    sendFailure(res, 500, error);
  } finally {
    await driver.quit();
  }
});

function sendSuccess(res, sfdxAuthUrl) {
  res.send({
    success: true,
    sfdxAuthUrl
  });
}

function sendFailure(res, statusCode, error) {
  res.status(statusCode).send({
    success: false,
    error
  });
}

const port = parseInt(process.env.PORT);
app.listen(port, () => {
  console.log(`Listening on port ${port}`)
});