import { describe, expect, it } from "vitest";
import { helpUrl } from "./helpAddress";

const OWN_HOST = "https://help.verticopolis.com";

describe("helpUrl", () => {
  it("keeps a manual path as it is in a build that serves the manual under /help", () => {
    expect(helpUrl("/help/rooms/hotels/", "")).toBe("/help/rooms/hotels/");
    expect(helpUrl("/help", "")).toBe("/help");
  });

  it("moves a manual path to the manual's own host, without the /help prefix", () => {
    expect(helpUrl("/help/", OWN_HOST)).toBe("https://help.verticopolis.com/");
    expect(helpUrl("/help", OWN_HOST)).toBe("https://help.verticopolis.com/");
    expect(helpUrl("/help/rooms/hotels/", OWN_HOST)).toBe("https://help.verticopolis.com/rooms/hotels/");
    expect(helpUrl("/help/changelog#4.3.0", OWN_HOST)).toBe("https://help.verticopolis.com/changelog#4.3.0");
    expect(helpUrl("/help?from=game", OWN_HOST)).toBe("https://help.verticopolis.com/?from=game");
  });

  it("leaves a path outside the manual alone", () => {
    expect(helpUrl("/helpdesk/", OWN_HOST)).toBe("/helpdesk/");
    expect(helpUrl("/gallery", OWN_HOST)).toBe("/gallery");
  });
});
