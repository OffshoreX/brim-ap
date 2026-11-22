import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApprovalStepper } from "@/components/ApprovalStepper";
import type { ApprovalChainStep, Me } from "@/lib/types";

const me: Me = { id: 2, name: "Marcus Webb", email: "m@x", title: null, role: "controller_admin" };
const step = (stepNo: number, userId: number, userName: string): ApprovalChainStep => ({
  stepNo, role: "approver", roleLabel: "Approver", userId, userName, delegatedFromId: null, delegatedFromName: null, reason: null, status: "pending",
});

describe("ApprovalStepper", () => {
  it("names the signed-in user's step 'You' and says it is waiting for them", () => {
    render(<ApprovalStepper chain={[step(1, 2, "Marcus Webb"), step(2, 3, "Elise Tremblay")]} decisions={[]} me={me} />);
    expect(screen.getByText("You (Marcus Webb)")).toBeTruthy();
    expect(screen.getByText("Elise Tremblay")).toBeTruthy();
    expect(screen.getAllByText("Waiting for you")).toHaveLength(1);
  });
});
