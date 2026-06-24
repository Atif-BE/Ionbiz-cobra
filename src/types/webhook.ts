export type IonBizNotification = {
  Id: number;
  Action: string;
  SysStartTime: string;
};

export type IonBizWebhookPayload = {
  Id: string;
  Attempt: number;
  Notifications: IonBizNotification[];
};
