import test from "node:test";
import assert from "node:assert/strict";
import { awardMonthProbeEvent } from "./award-state.js";

test("award month probe event has one consistent shape for zero and nonzero totals",()=>{
  assert.deepEqual(awardMonthProbeEvent("4015155301","2010-03",0),{type:"AWARD_MONTH_PROBE",target:"4015155301",month:"2010-03",probeTotal:0});
  assert.deepEqual(awardMonthProbeEvent("4015155301","2010-04",7),{type:"AWARD_MONTH_PROBE",target:"4015155301",month:"2010-04",probeTotal:7});
});
