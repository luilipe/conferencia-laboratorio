export function reportEmulatorsAllowed(enabled:string|undefined,projectId:string|undefined,hostname:string):boolean{
  return enabled==="true"&&projectId==="demo-client-reports"&&["localhost","127.0.0.1","[::1]"].includes(hostname);
}
