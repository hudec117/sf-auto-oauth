// sf-auto-oauth
// Copyright (C) 2023 Aurel Hudec

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

console.log(`
sf-auto-oauth
Copyright (C) 2023 Aurel Hudec
This program comes with ABSOLUTELY NO WARRANTY.
This is free software, and you are welcome to redistribute it under certain conditions; see LICENSE
`);

import { WebOAuthServer } from '@salesforce/core';
import { Builder, Browser, By, until } from 'selenium-webdriver';
import { TimeoutError, WebDriverError } from 'selenium-webdriver/lib/error.js';
import { Options } from 'selenium-webdriver/chrome.js';
import express from 'express';
import winston from 'winston';
import * as dotenv from 'dotenv';

// Resources
// https://cloud.google.com/run/docs/configuring/static-outbound-ip
// https://github.com/forcedotcom/sfdx-core/blob/main/src/webOAuthServer.ts
// https://github.com/forcedotcom/sfdx-core/blob/main/src/org/authInfo.ts

dotenv.config();

// Setup logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

const app = express();
app.use(express.json());

app.post('/auth', async (req, res) => {
  let username, password, instanceUrl;

  // IMPORTANT: Check process.env for environment variables
  // first as we don't want to give the caller the ability
  // to "override" the values set in the environment variables.

  // Username
  if ('SF_USERNAME' in process.env) {
    username = process.env.SF_USERNAME;
    logger.info('Got username from environment variable');
  } else if ('username' in req.body) {
    username = req.body.username;
    logger.info('Got username from body');
  } else {
    logger.info('Username not found in environment variable or HTTP body.');
    sendFailure(res, 400, 'Missing username.');
    return;
  }

  username = username.trim();
  if (username.length === 0) {
    logger.info('Username is only whitespace or empty.');
    sendFailure(res, 400, 'Username cannot be empty.');
    return;
  }


  // Password
  if ('SF_PASSWORD' in process.env) {
    password = process.env.SF_PASSWORD;
    logger.info('Got password from environment variable');
  } else if ('password' in req.body) {
    password = req.body.password;
    logger.info('Got password from body');
  } else {
    logger.info('Password not found in environment variable or HTTP body.');
    sendFailure(res, 400, 'Missing password.');
    return;
  }

  if (password.length === 0) {
    logger.info('Password is empty.');
    sendFailure(res, 400, 'Password cannot be empty.');
    return;
  }


  // Instance URL
  if ('SF_INSTANCE_URL' in process.env) {
    instanceUrl = process.env.SF_INSTANCE_URL;
    logger.info('Got instance URL from environment variable');
  } else if ('instanceUrl' in req.body) {
    instanceUrl = req.body.instanceUrl;
    logger.info('Got instance URL from body');
  } else {
    logger.info('Instance URL not found in environment variable or HTTP body.');
    sendFailure(res, 400, 'Missing instance URL.');
    return;
  }

  instanceUrl = instanceUrl.trim();
  if (instanceUrl.length === 0) {
    logger.info('Instance URL is empty.');
    sendFailure(res, 400, 'Instance URL cannot be empty.');
    return;
  }

  // Extra validation to make sure the instance URL is valid.
  const result = sanitiseInstanceUrl(instanceUrl);
  if (!result.valid) {
    logger.warning(`Received invalid instance URL ${instanceUrl}`);
    sendFailure(res, 400, 'Invalid instance URL.');
    return;
  }
  instanceUrl = result.url;


  logger.info('Authenticating using Selenium and Chrome...');

  // Prepare Selenium Chrome driver.
  const chromeOptions = new Options().headless();
  chromeOptions.addArguments('--no-sandbox');
  chromeOptions.addArguments('--disable-dev-shm-usage');
  chromeOptions.excludeSwitches(['enable-logging']);

  let chromeDriver;
  try {
    chromeDriver = await new Builder()
      .forBrowser(Browser.CHROME)
      .setChromeOptions(chromeOptions)
      .build();
  } catch (error) {
    logger.error(error.message);
    sendFailure(res, 500, 'Failed to build Selenium Chrome instance.');
    return;
  }

  let oauthServer;
  try {
    // Start the Salesforce OAuth Server to receive the OAuth response.
    oauthServer = await WebOAuthServer.create({
      oauthConfig: {
        loginUrl: instanceUrl
      }
    });

    // The "authorizeAndSave" function starts the HTTP server
    // listening on the ConnectedApp callback URL, we need to start
    // it here so when the browser is redirected to the callback URL,
    // there is a server waiting to process the request.
    const authAndSaveProm = oauthServer.authorizeAndSave();

    // Navigate to the OAuth authorization URL
    const authUrl = oauthServer.getAuthorizationUrl();
    await chromeDriver.get(authUrl);

    // Enter the username, password and click login.
    await chromeDriver.findElement(By.id('username')).sendKeys(username);
    await chromeDriver.findElement(By.id('password')).sendKeys(password);
    await chromeDriver.findElement(By.id('Login')).click();

    // Wait for up to 4 seconds to find the login error message
    try {
      await chromeDriver.wait(until.elementLocated(By.id('error')), 4000);

      logger.info('Error message found, login failed.');
      sendFailure(res, 401, 'Please check your username and password.');
      return;
    } catch (error) {
      if (error instanceof TimeoutError) {
        // Expected, happy path!
        logger.info('No error message after 4 seconds, assuming login successful.');
      } else {
        sendFailure(res, 500, error);
        return;
      }
    }

    // Wait for up to 4 seconds to find the "Approve" button if we
    // are redirected to the ConnectedApp's Reject/Approve page.
    try {
      await chromeDriver.wait(until.elementLocated(By.id('oaapprove')), 4000);

      logger.info('Redirected to Reject/Approve page, approving.');

      await chromeDriver.findElement(By.id('oaapprove')).click();
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.info('No "Approve" button after 4 seconds, assuming no approval required.');
      } else {
        sendFailure(res, 500, error);
        return;
      }
    }

    // Receive the OAuth response and get the authInfo object.
    const authInfo = await authAndSaveProm;

    const fields = authInfo.getFields(true);
    const sfdxAuthUrl = authInfo.getSfdxAuthUrl();

    logger.info(`Successfully authenticated against org ${fields.orgId}`);

    sendSuccess(res, {
      orgId: fields.orgId,
      accessToken: fields.accessToken,
      refreshToken: fields.refreshToken,
      sfdxAuthUrl: sfdxAuthUrl
    });
  } catch (error) {
    logger.error(error.message);
    if (error instanceof WebDriverError) {
      sendFailure(res, 500, error.message);
    } else {
      sendFailure(res, 500, error);
    }
  } finally {
    // Note: may not be necessary since the Salesforce code does this too in the Promise's finally() method
    // but it's important so the webserver is not kept open on a port.
    oauthServer.webServer.close();

    await chromeDriver.quit();
  }
});

function sanitiseInstanceUrl(instanceUrl) {
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

async function onExit() {
  logger.info('Received SIGINT/SIGTERM');

  logger.info('Exiting');
  process.exit();
}

const port = parseInt(process.env.PORT);
app.listen(port, () => {
  logger.info(`Listening on port ${port}`)
});

process.on('SIGINT', onExit);
process.on('SIGTERM', onExit);