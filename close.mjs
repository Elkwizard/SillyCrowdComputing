import http from "node:http";
import secret from "./secret.mjs";

const [,, host] = process.argv;

http.get(`${host}/close?${new URLSearchParams({ secret })}`);