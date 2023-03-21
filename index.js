import { WebOAuthServer } from '@salesforce/core';
import { Builder, Browser, By, until } from 'selenium-webdriver';
import { TimeoutError, WebDriverError } from 'selenium-webdriver/lib/error.js';
import { Options } from 'selenium-webdriver/chrome.js';
import express from 'express';
import * as dotenv from 'dotenv';

// Resources
// https://cloud.google.com/run/docs/configuring/static-outbound-ip
// https://github.com/forcedotcom/sfdx-core/blob/main/src/webOAuthServer.ts
// https://github.com/forcedotcom/sfdx-core/blob/main/src/org/authInfo.ts

dotenv.config();

const app = express();

app.get('/auth', async (req, res) => {
  let username, password, instanceUrl;

  // IMPORTANT: Check process.env for environment variables
  // first as we don't want to give the caller the ability
  // to "override" the values set in the environment variables.
  if ('SF_USERNAME' in process.env) {
    username = process.env.SF_USERNAME;
  } else if ('username' in req.query) {
    username = req.query.username;
  } else {
    sendFailure(res, 400, 'Missing username.');
    return;
  }

  if ('SF_PASSWORD' in process.env) {
    password = process.env.SF_PASSWORD;
  } else if ('password' in req.query) {
    password = req.query.password;
  } else {
    sendFailure(res, 400, 'Missing password.');
    return;
  }

  if ('SF_INSTANCE_URL' in process.env) {
    instanceUrl = process.env.SF_INSTANCE_URL;
  } else if ('instanceUrl' in req.query) {
    instanceUrl = req.query.instanceUrl;
  } else {
    sendFailure(res, 400, 'Missing instance URL.');
    return;
  }

  // Extra validation to make sure the instance URL is valid.
  const result = sanitiseInstanceUrl(instanceUrl);
  if (!result.valid) {
    sendFailure(res, 400, 'Invalid instance URL.');
    return;
  }
  instanceUrl = result.url;

  // Prepare Selenium Chrome driver.
  const chromeOptions = new Options().headless();
  chromeOptions.addArguments('--no-sandbox');
  chromeOptions.addArguments('--disable-dev-shm-usage');

  let driver;
  try {
    driver = await new Builder()
      .forBrowser(Browser.CHROME)
      .setChromeOptions(chromeOptions)
      .build();
  } catch (error) {
    sendFailure(res, 500, 'Failed to build Selenium Chrome instance.');
    return;
  }

  try {
    // Start the Salesforce OAuth Server to receive the OAuth response.
    const oauthServer = await WebOAuthServer.create({
      oauthConfig: {
        loginUrl: instanceUrl
      }
    });

    // The "authorizeAndSave" function starts the HTTP server
    // listening on the ConnectedApp callback URL, we need to start
    // it here so when the browser is redirected to the callback URL
    // there is a server waiting to process the request.
    const authAndSaveProm = oauthServer.authorizeAndSave();

    // Navigate to the OAuth authorization URL
    const authUrl = oauthServer.getAuthorizationUrl();
    await driver.get(authUrl);

    // Enter the username, password and click login.
    await driver.findElement(By.id('username')).sendKeys(username);
    await driver.findElement(By.id('password')).sendKeys(password);

    await driver.findElement(By.id('Login')).click();

    // Wait for up to 2 seconds to find the "Approve" button if we
    // are redirected to the ConnectedApp's Reject/Approve page.
    try {
      await driver.wait(until.elementLocated(By.id('oaapprove')), 2000);

      console.log('Redirected to Reject/Approve page...');

      await driver.findElement(By.id('oaapprove')).click();
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.log('No "Approve" button found, assuming no approval required...');
      } else {
        sendFailure(res, 500, error);
        return;
      }
    }

    // Receive the OAuth response and get the authInfo object.
    const authInfo = await authAndSaveProm;

    const fields = authInfo.getFields(true);
    const sfdxAuthUrl = authInfo.getSfdxAuthUrl();

    sendSuccess(res, {
      orgId: fields.orgId,
      accessToken: fields.accessToken,
      refreshToken: fields.refreshToken,
      sfdxAuthUrl: sfdxAuthUrl
    });
  } catch (error) {
    if (error instanceof WebDriverError) {
      sendFailure(res, 500, error.message);
    } else {
      sendFailure(res, 500, error);
    }
  } finally {
    await driver.quit();
  }
});

function sanitiseInstanceUrl(instanceUrl) {
  instanceUrl = instanceUrl.trim();

  if (instanceUrl.startsWith('http://')) {
    instanceUrl = instanceUrl.replace('http://', 'https://')
  } else if (!instanceUrl.startsWith('https://')) {
    instanceUrl = 'https://' + instanceUrl;
  }

  const isStandardDomain = ['https://test.salesforce.com', 'https://login.salesforce.com'].includes(instanceUrl);
  const isMyDomain = !/^https:\/\/[\w-]+\.sandbox\.my\.salesforce\.com$/.test(instanceUrl) || !/^https:\/\/[\w-]+\.my\.salesforce\.com$/.test(instanceUrl);
  if (!isMyDomain && !isStandardDomain) {
    return { valid: false };
  }

  return { valid: true, url: instanceUrl };
}

function sendSuccess(res, auth) {
  res.send({
    success: true,
    auth
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