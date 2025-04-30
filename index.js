const axios = require("axios");
const twilio = require("twilio");
const moment = require("moment-timezone");
require("dotenv").config();

const { ucfirst } = require("./utils");

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CALEOPRO_API_URL = "https://api.caleopro.com/prod/graphql/";

const USERNAME = "j15739i@lvmpd.com",
  PASSWORD = "Ih@tecaleo8",
  USER_ID = "65810eb96b4100cdebc8afd1";

const PROCESSED_OVERTIME_IDS = [];

const getAuthentication = async (refreshToken) => {
  const url = "https://cognito-idp.us-west-2.amazonaws.com/";
  const clientId = "194hcard9krifeplo6qgbci33a";
  const payload = refreshToken
    ? {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: {
          DEVICE_KEY: null,
          REFRESH_TOKEN: refreshToken,
        },

        ClientId: clientId,
      }
    : {
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: {
          USERNAME,
          PASSWORD,
        },
        ClientId: clientId,
        ClientMetadata: {},
      };
  try {
    const {
      data: {
        AuthenticationResult: { AccessToken: accessToken, RefreshToken: refreshToken },
      },
    } = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
        //   "x-amz-user-agent": "aws-amplify/5.0.4 auth framework/1",
      },
    });
    return { authentication: { accessToken, refreshToken } };
  } catch (error) {
    return { error: error.message };
  }
};

const signUp = ({ overtime, authentication }) => {
  const payload = overtime.shiftBufferShift
    ? {
        operationName: "CreateShiftBuffer",
        query:
          "mutation CreateShiftBuffer($input: CreateShiftBufferRequest) { shiftBufferRequest(shiftBufferRequest: $input) { id } }",
        variables: {
          input: {
            shiftId: overtime.id,
            shiftBufferShiftId: overtime.shiftBufferShift.id,
            userId: USER_ID,
            note: "",
          },
        },
      }
    : {
        operationName: "AssignShift",
        query:
          "mutation AssignShift($id: String!, $userId: String, $note: String) { shiftAssign(id: $id, userId: $userId, note: $note) { id } }",
        variables: {
          id: overtime.id,
          userId: USER_ID,
        },
      };
  axios
    .post(CALEOPRO_API_URL, payload, {
      headers: {
        Authorization: "Bearer " + authentication.accessToken,
      },
    })
    .then((response) => {
      console.log(response.data);
    })
    .catch((error) => {
      console.error(error);
    });
};

const getOvertimes = (options) => {
  const payload = {
    operationName: "GetAvailableShifts",
    query:
      "query GetAvailableShifts($input: AvailableShiftsSearchInput!) {\n  availableShifts(input: $input) {\n    items {\n      id\n      shiftId\n      startTime\n      endTime\n      refNumber\n      event {\n        id\n        referenceId\n        name\n        attachments\n        notes\n        status\n        scheduledInterestList\n        scheduledCloseInterestList\n        scheduledFirstComeFirstServe\n        lotteryNumber\n        lotteryCounter {\n          start\n          __typename\n        }\n        venue {\n          id\n          name\n          address\n          city\n          state\n          zip\n          phone\n          contact {\n            firstName\n            lastName\n            email\n            phone\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      assignment {\n        id\n        name\n        bwNeeded\n        description\n        reportingLocation\n        requiredSkills {\n          id\n          name\n          __typename\n        }\n        ranks {\n          id\n          name\n          __typename\n        }\n        __typename\n      }\n      otherShiftSlots {\n        id\n        refNumber\n        user {\n          id\n          firstName\n          lastName\n          member {\n            pNumber\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      shiftInterestRequest {\n        id\n        __typename\n      }\n      shiftBufferShift {\n        id\n        shiftId\n        startTime\n        endTime\n        assignment {\n          id\n          name\n          __typename\n        }\n        event {\n          id\n          name\n          __typename\n        }\n        __typename\n      }\n      user {\n        id\n        name\n        __typename\n      }\n      __typename\n    }\n    total\n    __typename\n  }\n}",
    variables: {
      input: {
        limit: 10000,
        skip: 0,
        orderBy: "startTime",
        order: "asc",
        upcoming: options?.type === "upcoming",
      },
    },
  };
  axios
    .post(CALEOPRO_API_URL, payload, {
      headers: {
        Authorization: "Bearer " + options?.authentication?.accessToken,
      },
    })
    .then((response) => {
      const { data } = response.data;
      const { items: overtimes } = data.availableShifts;
      const analysis = { count: {} };
      let message = "";
      for (let i = 0; i < overtimes.length; i++) {
        const {
          id,
          event: { status },
        } = overtimes[i];
        if (!analysis.count[status]) {
          analysis.count[status] = 0;
        }
        analysis.count[status]++;
        if (
          // options?.type === "available" &&
          status === "FIRST_COME_FIRST_SERVE" &&
          !PROCESSED_OVERTIME_IDS.includes(id)
        ) {
          if (options?.type === "available" && process.env.ALLOW_SIGN_UP === "true") {
            signUp({
              overtime: overtimes[i],
              authentication: options.authentication,
            });
          }
          const {
            event: { name: eventName },
            assignment: { name: assignmentName },
          } = overtimes[i];
          const startTime = moment(overtimes[i].startTime).tz("America/Los_Angeles");
          const endTime = moment(overtimes[i].endTime).tz("America/Los_Angeles");
          message +=
            "\n\n" +
            eventName +
            " - " +
            assignmentName +
            "\n" +
            endTime.diff(startTime, "hour") +
            " hours | " +
            startTime.format("ddd DD MMM YYYY HH:mm") +
            " - " +
            endTime.format("ddd DD MMM YYYY HH:mm");
          PROCESSED_OVERTIME_IDS.push(id);
          if (message.length > 1000) {
            break;
          }
        }
      }
      // console.log(analysis);
      // if (
      //   (options?.type === "available" && Object.keys(analysis.count).length > 0) ||
      //   (options?.type === "upcoming" && Object.keys(analysis.count).length > 1)
      // ) {
      //   console.log(analysis);
      // }
      if (message.length > 0) {
        message = ucfirst(options?.type) + " Overtime" + message;
        // console.log(message);
        twilioClient.messages
          .create({
            to: process.env.USER_PHONE_NUMBER,
            from: process.env.TWILIO_PHONE_NUMBER,
            body: message,
          })
          .then((message) => {
            console.log(message);
          })
          .catch((error) => {
            console.error(error);
          });
      }
      getOvertimes(options);
    })
    .catch(async ({ status, message }) => {
      if (status === 401) {
        console.warn("Token expired, refreshing token...");
        // Refresh the token and retry the request
        const { authentication, error } = await getAuthentication(options?.authentication?.refreshToken);
        if (error) {
          console.error(error);
        } else {
          getOvertimes({ ...options, authentication });
        }
      } else {
        console.error(message);
      }
    });
};

getOvertimes({ type: process.argv[2] });
