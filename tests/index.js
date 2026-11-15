/* AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */
"use strict";
// Makes `node --test tests/` work on Node 21 and later, which run a folder given on the command line as one script
// (this file). It loads every *.test.js file next to it. `node --test` with no folder finds the same files itself.
const fs = require("fs");
const path = require("path");

for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith(".test.js")).sort()) require(path.join(__dirname, f));
