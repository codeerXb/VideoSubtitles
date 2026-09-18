import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App";

describe("web workspace", () => {
  it("shows the product promise and login form for a signed-out visitor", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /把视频变成\s*可复用的知识/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送登录链接" })).toBeInTheDocument();
  });
});
