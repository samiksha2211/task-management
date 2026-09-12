export async function sendSMS(
  mobileNumber: string,
  message: string
): Promise<string> {
  const user = process.env.SMSCOUNTRY_USER;
  const password = process.env.SMSCOUNTRY_PASSWORD;
  const senderId = process.env.SMSCOUNTRY_SENDER_ID || "RUNGRL";

  const url =
    process.env.SMSCOUNTRY_URL ||
    "https://www.smscountry.com/SMSCwebservice_Bulk.aspx";

  if (!user || !password) {
    throw new Error("SMSCountry credentials are missing");
  }
  const testMessage = "DRM/PRYJ: A task has been assigned to you. Task: \"{$td}\", Due Date: {$aa}. Please take necessary action.";
  //"Defective Device no. 124 is received under defected due to Designation issue, Regards, RUNGRL";
 
     const normalizedMobile = mobileNumber
    .replace(/\D/g, "")
    .replace(/^91/, "");

  if (!/^[6-9]\d{9}$/.test(normalizedMobile)) {
    throw new Error(`Invalid Indian mobile number: ${mobileNumber}`);
  }

  const indianMobile = `91${normalizedMobile}`;
  const body = new URLSearchParams({
    User: user,
    passwd: password,
    mobilenumber: indianMobile,
    message,
    sid: senderId,
    mtype: "N",
    DR: "Y",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });


  const result = await response.text();

  console.log("SMSCountry response:", result);

  if (
    !response.ok||
    /invalid password/i.test(result) ||
    /invalid user/i.test(result) ||
    /error/i.test(result)
)
   {
    throw new Error(`SMSCountry request failed: ${result}`);
  }

  return result;
}