import { describe, it, expect } from "vitest";
import { parsePlaybooksFromMarkdown } from "../../src/services/playbook.service.js";

const SAMPLE = `
### 1. Supply Mismatch

**Alert Type**: \`supply_mismatch\`
**Typical Severity**: Critical / High
**Description**: Detected mismatch between Stellar supply and source chain reserves

#### Immediate Actions

1. **Verify the Alert**
   Check current supply data.

2. **Assess Severity**
   Compare mismatch percentage.
`;

describe("playbook parsing", () => {
  it("extracts alert playbooks from markdown", () => {
    const playbooks = parsePlaybooksFromMarkdown(SAMPLE);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].alertType).toBe("supply_mismatch");
    expect(playbooks[0].steps.length).toBeGreaterThanOrEqual(2);
  });
});
