export function parsePerformanceSampleCount(value, fallback = 3) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 20) throw new RangeError('PERFORMANCE_BASELINE_RUNS must be an integer from 1 to 20.');
  return parsed;
}
export function summarizePerformanceSamples(samples, metric) {
  const values = samples.map((sample,index)=>({value:sample?.[metric],run:Number.isSafeInteger(sample?.run)&&sample.run>0?sample.run:index+1}))
    .filter(item=>typeof item.value==='number'&&Number.isFinite(item.value)).sort((a,b)=>a.value-b.value);
  if (!values.length) return {sampleCount:0,min:null,p25:null,median:null,p75:null,p95:null,max:null,mean:null,variance:null,standardDeviation:null,interquartileRange:null,outlierRunNumbers:[]};
  const nums=values.map(x=>x.value),n=nums.length,m=Math.floor(n/2);
  const median=n%2?nums[m]:(nums[m-1]+nums[m])/2,mean=nums.reduce((a,b)=>a+b,0)/n;
  const variance=nums.reduce((a,b)=>a+(b-mean)**2,0)/n;
  const p25=nums[Math.max(0,Math.ceil(n*.25)-1)],p75=nums[Math.max(0,Math.ceil(n*.75)-1)],iqr=p75-p25;
  return {sampleCount:n,min:nums[0],p25,median,p75,p95:nums[Math.max(0,Math.ceil(n*.95)-1)],max:nums[n-1],mean,variance,standardDeviation:Math.sqrt(variance),interquartileRange:iqr,outlierRunNumbers:values.filter(x=>x.value<p25-1.5*iqr||x.value>p75+1.5*iqr).map(x=>x.run).sort((a,b)=>a-b)};
}
export function summarizePerformanceViewport(samples) {
  const metrics=['elapsedToPortfolioReadyMs','elapsedToTradesDeskReadyMs','authShellReadyMs','authenticationMs','fixtureHydrationMs','brokerRefreshAndParityMs','portfolioRenderReadyMs','tradesDeskReadyMs','firstContentfulPaintMs','largestContentfulPaintMs','cumulativeLayoutShift','totalResourceTransferBytes','resourceCount','heapUsedBytes','domNodeCount'];
  return Object.fromEntries(metrics.map(metric=>[metric,summarizePerformanceSamples(samples,metric)]));
}
export function buildPerformanceEnvironmentMetadata(input) {
  const str=v=>typeof v==='string'&&v.trim()?v.trim():null;
  return {platform:str(input?.platform),osRelease:str(input?.osRelease),architecture:str(input?.architecture),nodeVersion:str(input?.nodeVersion),cpuModel:str(input?.cpuModel),logicalCpuCount:Number.isSafeInteger(input?.logicalCpuCount)&&input.logicalCpuCount>0?input.logicalCpuCount:null,runnerImageOS:str(input?.runnerImageOS),runnerImageVersion:str(input?.runnerImageVersion),browserName:str(input?.browserName),browserVersion:str(input?.browserVersion),headless:input?.headless===true,viewports:Array.isArray(input?.viewports)?input.viewports.map(v=>({name:str(v?.name),width:Number.isSafeInteger(v?.width)&&v.width>0?v.width:null,height:Number.isSafeInteger(v?.height)&&v.height>0?v.height:null})):[]};
}
