# Salesforce Auto OAuth

Simple containerized HTTP API to automate the OAuth flow for service accounts that are looking to headlessly authenticate against newly refreshed/created sandboxes **without** manual login.

## What for?

At the time of writing, it's not possible to headlessly authenticate against a newly refreshed/created sandbox without going through the login UI flow. Even the OAuth JWT Bearer flow requires you to login via the UI and get the connected app consumer secret/key to enable headless authentication.

**This is a pain for automation.**

## How?

tl;dr Selenium to automate the login UI flow using username/password and then return an SFDX Auth URL.

You need 2-3 things when authenticating using the OAuth flow:

* Username: When a sandbox is refreshed/created, all the usernames are modified to ensure global uniqueness. This is predictable.
* Password: When a sandbox is refreshed/created, all the users are copied over and so are their passwords. So if you have a service account (e.g. admin user to perform CI/CD) in prod, it's password will remain the same in all sandboxes.
* Sandbox instance URL: If you have MyDomain enabled this is predictable as it will consist of your org name and the sandbox name. If you don't have MyDomain enabled it will be test.salesforce.com.

This API accepts the above 3 either as query parameters or as environment variables.

Given the password doesn't change, it is the perfect candidate to be stored in a secret manager (e.g. Google Cloud Secret Manager, Azure Key Vault) and subsequently accessed as an environment variable.

Once the API has all 3 of the above, it does the following:

1. Uses `@salesforce/core/WebOAuthServer` class to get the OAuth authorization URL.
    * This is the same code that powers the `sf org login web` command.
2. Starts Selenium and navigates to the authorization URL.
3. Fills in the username/password on the page using Selenium and clicks Login.
4. Uses the same `WebOAuthServer` to create an HTTP server on the callback URL and captures the OAuth response.
5. Sends back authentication information.

### Don't you need a connected app for the OAuth flow?

Yes! But all environments have a hidden connected app that SFDX uses for the OAuth flow and since we're using the same library (`@salesforce/core`) that SFDX uses, we get to use that connected app too.

## Setup

### Standalone

1. TODO


### Docker

1. Use Docker to build an image using the Dockerfile.
    * Note: the Dockerfile downloads the latest version of Chrome but the Selenium Chrome Driver version is fixed. You may need to update the Chrome Driver version manually. (if it starts to break)
2. Deploy to the cloud (tested on GCP's Cloud Run)

### Trusted IP Ranges

Wherever you decide to host this API, you will need to configure your production org's Trusted IP Ranges to include the host's IP. Otherwise, Salesforce will require 2FA which this API cannot get around. Configuring static IP addresses on cloud hosting is recommended.

As sandboxes are created/refreshed they will take these trusted IP ranges with them.

### Environment Variables

1. TODO


## Usage

URL: `POST /auth`

Body:
```json
{
    "username": "",
    "password": "",
    "instanceUrl": ""
}
```

Any of the fields can be omitted provided an environment variable is configured as described in the Setup section. For example, if you only want to specify the username and instance URL:

```json
{
    "username": "",
    "instanceUrl": ""
}
```

the API will search for the SF_PASSWORD environment variable instead. Same applies to omitting the other parameters.

Example response:
```json
{
    "success": true,
    "auth": {
        "orgId": "[ORG ID]",
        "accessToken": "[ACCESS TOKEN]",
        "refreshToken": "[REFRESH TOKEN]",
        "sfdxAuthUrl": "[SFDX AUTH URL]"
    }
}
```

where `[SFDX AUTH URL]` is in this format: `force://<clientId>:<clientSecret>:<refreshToken>@<instanceUrl>`

This can be saved to a file and used with the `sf org login sfdx-url` [command](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_org_commands_unified.htm#cli_reference_org_login_sfdx-url_unified) to authenticate SFDX against a sandbox. Or you can extract the refresh token and do as you wish.

## Security