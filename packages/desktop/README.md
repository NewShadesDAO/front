# NewShades desktop

This is the home of the NewShades desktop and web client.

Some desktop builds can be found on [the release page](https://github.com/NewShadesDAO/front/releases), but until we get automatic updates going the easiest way to follow along is to access the regular web app on [app.newshades.xyz](https://app.newshades.xyz).

## Introduction

*NewShades desktop* is a [`React`](https://reactjs.org/) web app, using a thin [`Electron`](https://www.electronjs.org/) wrapper to build for desktop. The details might change quickly but at the time of writing we bundle our Javascript with [`webpack`](https://webpack.js.org/), transpile with [`SWC`](https://swc.rs/); and  package, make distributals, and publish our desktop builds with [`Electron Forge`](https://www.electronforge.io/).

### Development setup

Make sure you have [`Node.js`](https://nodejs.org/en/) and [`NPM`](https://www.npmjs.com/) installed, preferrably through a version manager, like [`nvm`](https://github.com/nvm-sh/nvm), [`fnm`](https://github.com/Schniz/fnm), or [`n`](https://github.com/tj/n).

Clone the repo and install dependencies with:

```sh
npm install
```

Start a local dev server with:

```sh
npm run start-web
```

By default this expects the [NewShades API](https://github.com/NewShadesDAO/api) to be running on `localhost:5001`, but you can override this with an environment variable `API_ENDPOINT`:

```sh
API_ENDPOINT=https://api.newshades.xyz npm run start-web
```

Start the desktop client with:

```sh
# This expects the dev server to be running
npm run start-desktop
```

### Deployment

`HEAD` of `main` is automatically deployed to [app.newshades.xyz](https://app.newshades.xyz) with [Vercel](https://vercel.com/).

Desktop builds are currently manual. 

## Contributing

We’re just getting started and things are still rather messy, but we’d love your help if you’re up for it! Pull requests are welcome, but the best place to start right now is probably the [#development channel](https://discord.com/channels/913721755670040587/929759842682429490) on the [NewShades Discord](https://discord.com/invite/2jy5A5h63H).


