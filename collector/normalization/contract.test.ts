import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContract, parseContractCorporations, parseContractDemandInstitutions } from "./contract.js";

test("parses KONEPS delimited corporation members without treating corpList as JSON",()=>{
  assert.deepEqual(parseContractCorporations("[1^주계약업체^공동^주식회사 A^대표A^대한민국^60^주식회사 A^^1111111111],[2^구성업체^공동^주식회사 B^대표B^대한민국^40^주식회사 B^^2222222222]").map(x=>({sequence:x.sequenceNo,role:x.roleName,name:x.corporationName,share:x.shareRate,businessNo:x.businessRegistrationNo})),[
    {sequence:1,role:"주계약업체",name:"주식회사 A",share:"60",businessNo:"1111111111"},
    {sequence:2,role:"구성업체",name:"주식회사 B",share:"40",businessNo:"2222222222"},
  ]);
});

test("parses demand institutions separately from the contracting institution",()=>{
  const normalized=normalizeContract({dcsnCntrctNo:"D-1",cntrctInsttNm:"계약기관",dminsttList:"[1^A01^수요기관 A^지방자치단체^^^],[2^B02^수요기관 B^공기업^^^]",thtmCntrctAmt:"796000",totCntrctAmt:"0"});
  assert.equal(normalized.candidate.contractInstitutionName,"계약기관");
  assert.equal(normalized.candidate.demandInstitutionName,"수요기관 A");
  assert.equal(normalized.candidate.contractAmount,796000n);
  assert.equal(normalized.candidate.totalContractAmount,0n);
  assert.deepEqual(parseContractDemandInstitutions("[1^A01^수요기관 A^지방자치단체^^^]")[0]?.institutionCode,"A01");
});
