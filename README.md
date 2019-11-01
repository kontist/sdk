# Kontist SDK

JavaScript SDK for connecting to Kontist using OAuth2 and GraphQL.

## Installation

Add as dependency to your project:

```bash
npm install @kontist/client
```

You will need a valid client id and setup your redirect uri for authentication. You may request your client id in the API Console on https://kontist.dev/console/.

## Usage (NodeJS / TypeScript)

```typescript
import express from "express";
import { Client } from "@kontist/client";

const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = <YOUR_BASE_URL> + CALLBACK_PATH;
const clientSecret = <YOUR_CLIENT_SECRET>;
const state = (Math.random() + "").substring(2);
const app = express();

// create a client
const client = new Client({
  clientId: "YOUR_CLIENT_ID",
  redirectUri: REDIRECT_URI,
  scopes: ["transactions"],
  clientSecret,
  state
});

// redirect not authenticated user to Kontist form
app.get("/auth", async (req, res) => {
  const uri = await client.auth.getAuthUri();
  res.redirect(uri);
});

// get user token data
app.get(CALLBACK_PATH, async (req, res) => {
  const callbackUrl = req.originalUrl;

  try {
    const token = await client.auth.fetchToken(callbackUrl);
    /* got access token, login successful */
    res.send("Successful, your token is " + token.accessToken);
  } catch (e) {
    /* handle error */
    res.send("Failed: " + JSON.stringify(e));
  }
});

app.listen(3000, function() {
  console.log("Listening on port 3000!");
});
```

You should be able to issue new accessToken by simply calling:

```typescript
await token.refresh((newToken) => { ... });
```

## Usage (Browser)

```html
<html>
  <body>
    <script src="https://cdn.kontist.com/sdk.min.js"></script>
    <script>
      // persist a random value
      sessionStorage.setItem(
        "state",
        sessionStorage.getItem("state") || (Math.random() + "").substring(2)
      );
      sessionStorage.setItem(
        "verifier",
        sessionStorage.getItem("verifier") || (Math.random() + "").substring(2)
      );

      // initialize Kontist client
      const client = new Kontist.Client({
        clientId: "<your client id>",
        redirectUri: "<your base url>",
        scopes: ["transactions"],
        state: sessionStorage.getItem("state"),
        verifier: sessionStorage.getItem("verifier")
      });

      const params = new URL(document.location).searchParams;
      const code = params.get("code");
      if (!code) {
        // page not called with "code" query parameter, let's redirect the user to the login
        client.auth.getAuthUri().then(function(url) {
          window.location = url;
        });
      } else {
        // we have a code, the client now can fetch a token
        client.auth.fetchToken(document.location.href).then(function() {
          // do a simple graphql query and output the account id
          client.graphQL
            .rawQuery(
              `{
              viewer {
                mainAccount {
                  iban
                  balance
                }
              }
            }`
            )
            .then(function(result) {
              console.log(result);
            });
        });
      }
    </script>
  </body>
</html>
```

### GraphQL queries

#### Raw

```typescript
const query = `{
  viewer {
    mainAccount {
      id
    }
  }
}`;

const result = await client.graphQL.rawQuery(query);
```

#### Transactions

An example to show how to fetch all user transactions

```typescript
let transactions = [];
for await (const transaction of client.models.transaction) {
  transactions = transactions.concat(transaction);
}
```

To fetch up to 50 latest transactions:

```typescript
const transactions = await client.models.transaction.fetch();
```

#### Transfers

To create and confirm a transfer:

```typescript
const confirmationId = await client.models.transfer.createOne({
  amount: <amount>,
  recipient: <recipent_name>,
  iban: <recipent_iban>,
  purpose: <optional_description>,
  e2eId: <optional_e2eId>,
});

// wait for sms
const smsToken = ...

const result = await client.models.transfer.confirmOne(
  confirmationId,
  smsToken
);
```

To create and confirm multiple transfers (with only one confirmation):

```typescript
const confirmationId = await client.models.transfer.createMany([{
  amount: <amount>,
  recipient: <recipent_name>,
  iban: <recipent_iban>,
  purpose: <optional_description>,
  e2eId: <optional_e2eId>,
}, {
  amount: <amount>,
  recipient: <recipent_name>,
  iban: <recipent_iban>,
  purpose: <optional_description>,
  e2eId: <optional_e2eId>,
}]);

// wait for sms
const smsToken = ...

const result = await client.models.transfer.confirmMany(
  confirmationId,
  smsToken
);
```
