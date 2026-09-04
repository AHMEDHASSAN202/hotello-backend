import { GuestLanguage } from '../tenant-stays/stays.constants';

/**
 * The actual push copy (23.4 AC1/AC2, 23.5 AC1/AC2) — one file, all 7 guest
 * locales, kept separate from `push-registry.ts` (wiring) so a translation
 * fix never touches the type registry. AR/EN are the source of truth (spec);
 * RU/FR/IT/ES/DE are real translations of those exact strings, matching the
 * tone already shipped in `events/event-announce.util.ts` (warm, short,
 * Latin digits, emoji kept).
 */

interface PushLine {
  title: string;
  body: string;
}

export type RequestStatusPushKey = 'in_progress' | 'done' | 'cancelled';
export type OrderStatusPushKey =
  | 'preparing'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

/** 23.4 AC1 — request transitions that push, keyed by REQUEST_STATUSES. */
export const REQUEST_STATUS_LINES: Record<
  GuestLanguage,
  Record<RequestStatusPushKey, (name: string) => PushLine>
> = {
  ar: {
    in_progress: (n) => ({
      title: 'طلبك قيد التنفيذ ✨',
      body: `طلبك «${n}» قيد التنفيذ الآن`,
    }),
    done: (n) => ({
      title: 'تم تنفيذ طلبك ✅',
      body: `طلبك «${n}» أصبح جاهزًا`,
    }),
    cancelled: (n) => ({
      title: 'تم إلغاء طلبك',
      body: `نأسف — تعذّر تنفيذ طلبك «${n}». التفاصيل داخل التطبيق`,
    }),
  },
  en: {
    in_progress: (n) => ({
      title: 'Your request is in progress ✨',
      body: `“${n}” is being taken care of`,
    }),
    done: (n) => ({
      title: 'Your request is done ✅',
      body: `“${n}” has been completed`,
    }),
    cancelled: (n) => ({
      title: 'Request cancelled',
      body: `Sorry — “${n}” couldn’t be fulfilled. Details in the app`,
    }),
  },
  ru: {
    in_progress: (n) => ({
      title: 'Ваш запрос выполняется ✨',
      body: `«${n}» уже в работе`,
    }),
    done: (n) => ({
      title: 'Ваш запрос выполнен ✅',
      body: `«${n}» готово`,
    }),
    cancelled: (n) => ({
      title: 'Запрос отменён',
      body: `Извините — не удалось выполнить «${n}». Подробности в приложении`,
    }),
  },
  fr: {
    in_progress: (n) => ({
      title: 'Votre demande est en cours ✨',
      body: `« ${n} » est en cours de traitement`,
    }),
    done: (n) => ({
      title: 'Votre demande est terminée ✅',
      body: `« ${n} » a été complétée`,
    }),
    cancelled: (n) => ({
      title: 'Demande annulée',
      body: `Désolé — « ${n} » n’a pas pu être réalisée. Détails dans l’application`,
    }),
  },
  it: {
    in_progress: (n) => ({
      title: 'La tua richiesta è in corso ✨',
      body: `“${n}” è in lavorazione`,
    }),
    done: (n) => ({
      title: 'La tua richiesta è completata ✅',
      body: `“${n}” è stata completata`,
    }),
    cancelled: (n) => ({
      title: 'Richiesta annullata',
      body: `Siamo spiacenti — non è stato possibile evadere “${n}”. Dettagli nell’app`,
    }),
  },
  es: {
    in_progress: (n) => ({
      title: 'Tu solicitud está en curso ✨',
      body: `“${n}” se está atendiendo`,
    }),
    done: (n) => ({
      title: 'Tu solicitud está lista ✅',
      body: `“${n}” se ha completado`,
    }),
    cancelled: (n) => ({
      title: 'Solicitud cancelada',
      body: `Lo sentimos — no fue posible completar “${n}”. Detalles en la app`,
    }),
  },
  de: {
    in_progress: (n) => ({
      title: 'Deine Anfrage wird bearbeitet ✨',
      body: `„${n}“ wird gerade erledigt`,
    }),
    done: (n) => ({
      title: 'Deine Anfrage ist erledigt ✅',
      body: `„${n}“ wurde abgeschlossen`,
    }),
    cancelled: (n) => ({
      title: 'Anfrage storniert',
      body: `Entschuldigung — „${n}“ konnte nicht erledigt werden. Details in der App`,
    }),
  },
};

/** 23.4 AC2 — order transitions that push, keyed by FNB_ORDER_STATUSES. */
export const ORDER_STATUS_LINES: Record<
  GuestLanguage,
  Record<
    OrderStatusPushKey,
    (itemCount: number, locationLine: string | null) => PushLine
  >
> = {
  ar: {
    preparing: (c) => ({
      title: 'مطبخنا استلم طلبك 👨‍🍳',
      body: c === 1 ? 'يتم تجهيز صنف واحد' : `يتم تجهيز ${c} أصناف`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'طلبك في الطريق إليك 🛎️',
      body: loc ? `في الطريق الآن — ${loc}` : 'في الطريق إلى غرفتك الآن',
    }),
    delivered: () => ({
      title: 'تم توصيل طلبك ✅',
      body: 'بالهناء والشفاء! 🍽️',
    }),
    cancelled: () => ({
      title: 'تم إلغاء الطلب',
      body: 'نأسف — تعذّر تجهيز طلبك. التفاصيل داخل التطبيق',
    }),
  },
  en: {
    preparing: (c) => ({
      title: 'The kitchen has your order 👨‍🍳',
      body: c === 1 ? 'Preparing 1 item' : `Preparing ${c} items`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'Your order is on the way 🛎️',
      body: loc ? `Heading to you now — ${loc}` : 'Heading to your room now',
    }),
    delivered: () => ({
      title: 'Order delivered ✅',
      body: 'Enjoy! 🍽️',
    }),
    cancelled: () => ({
      title: 'Order cancelled',
      body: 'Sorry — your order couldn’t be prepared. Details in the app',
    }),
  },
  ru: {
    preparing: (c) => ({
      title: 'Кухня уже готовит ваш заказ 👨‍🍳',
      body: c === 1 ? 'Готовится 1 позиция' : `Готовится: ${c} шт.`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'Ваш заказ уже в пути 🛎️',
      body: loc ? `Уже в пути — ${loc}` : 'Уже в пути к вашему номеру',
    }),
    delivered: () => ({
      title: 'Заказ доставлен ✅',
      body: 'Приятного аппетита! 🍽️',
    }),
    cancelled: () => ({
      title: 'Заказ отменён',
      body: 'Извините — не удалось приготовить ваш заказ. Подробности в приложении',
    }),
  },
  fr: {
    preparing: (c) => ({
      title: 'La cuisine prépare votre commande 👨‍🍳',
      body: c === 1 ? '1 article en préparation' : `${c} articles en préparation`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'Votre commande est en route 🛎️',
      body: loc ? `En route maintenant — ${loc}` : 'En route vers votre chambre',
    }),
    delivered: () => ({
      title: 'Commande livrée ✅',
      body: 'Bon appétit ! 🍽️',
    }),
    cancelled: () => ({
      title: 'Commande annulée',
      body: 'Désolé — votre commande n’a pas pu être préparée. Détails dans l’application',
    }),
  },
  it: {
    preparing: (c) => ({
      title: 'La cucina ha ricevuto il tuo ordine 👨‍🍳',
      body: c === 1 ? '1 articolo in preparazione' : `${c} articoli in preparazione`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'Il tuo ordine è in arrivo 🛎️',
      body: loc ? `In arrivo ora — ${loc}` : 'In arrivo nella tua camera',
    }),
    delivered: () => ({
      title: 'Ordine consegnato ✅',
      body: 'Buon appetito! 🍽️',
    }),
    cancelled: () => ({
      title: 'Ordine annullato',
      body: 'Siamo spiacenti — non è stato possibile preparare il tuo ordine. Dettagli nell’app',
    }),
  },
  es: {
    preparing: (c) => ({
      title: 'La cocina tiene tu pedido 👨‍🍳',
      body: c === 1 ? 'Preparando 1 artículo' : `Preparando ${c} artículos`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'Tu pedido está en camino 🛎️',
      body: loc ? `En camino ahora — ${loc}` : 'En camino a tu habitación',
    }),
    delivered: () => ({
      title: 'Pedido entregado ✅',
      body: '¡Buen provecho! 🍽️',
    }),
    cancelled: () => ({
      title: 'Pedido cancelado',
      body: 'Lo sentimos — no fue posible preparar tu pedido. Detalles en la app',
    }),
  },
  de: {
    preparing: (c) => ({
      title: 'Die Küche bereitet deine Bestellung vor 👨‍🍳',
      body: c === 1 ? '1 Artikel wird zubereitet' : `${c} Artikel werden zubereitet`,
    }),
    on_the_way: (_c, loc) => ({
      title: 'Deine Bestellung ist unterwegs 🛎️',
      body: loc ? `Jetzt unterwegs — ${loc}` : 'Jetzt unterwegs zu deinem Zimmer',
    }),
    delivered: () => ({
      title: 'Bestellung geliefert ✅',
      body: 'Guten Appetit! 🍽️',
    }),
    cancelled: () => ({
      title: 'Bestellung storniert',
      body: 'Entschuldigung — deine Bestellung konnte nicht zubereitet werden. Details in der App',
    }),
  },
};

/** "{title} starts at {time} 🧘 — {location}" per language (23.5 AC1). */
const EVENT_REMINDER: Record<
  GuestLanguage,
  {
    title: string;
    body: (title: string, startTime: string, locationText: string | null) => string;
  }
> = {
  ar: {
    title: 'تذكير بفعاليتك 🧘',
    body: (t, s, l) => `${t} تبدأ الساعة ${s} 🧘${l ? ` — ${l}` : ''}`,
  },
  en: {
    title: 'Event reminder 🧘',
    body: (t, s, l) => `${t} starts at ${s} 🧘${l ? ` — ${l}` : ''}`,
  },
  ru: {
    title: 'Напоминание о мероприятии 🧘',
    body: (t, s, l) => `${t} начинается в ${s} 🧘${l ? ` — ${l}` : ''}`,
  },
  fr: {
    title: 'Rappel d’événement 🧘',
    body: (t, s, l) => `${t} commence à ${s} 🧘${l ? ` — ${l}` : ''}`,
  },
  it: {
    title: 'Promemoria evento 🧘',
    body: (t, s, l) => `${t} inizia alle ${s} 🧘${l ? ` — ${l}` : ''}`,
  },
  es: {
    title: 'Recordatorio de evento 🧘',
    body: (t, s, l) => `${t} comienza a las ${s} 🧘${l ? ` — ${l}` : ''}`,
  },
  de: {
    title: 'Erinnerung an dein Event 🧘',
    body: (t, s, l) => `${t} beginnt um ${s} Uhr 🧘${l ? ` — ${l}` : ''}`,
  },
};

export function composeEventReminder(
  lang: GuestLanguage,
  title: string,
  startTime: string,
  locationText: string | null,
): PushLine {
  const spec = EVENT_REMINDER[lang];
  return { title: spec.title, body: spec.body(title, startTime, locationText) };
}

/** "We hope you enjoyed your stay 🌅" + checkout time + optional balance line (23.5 AC2). */
const CHECKOUT_REMINDER: Record<
  GuestLanguage,
  {
    title: string;
    body: (checkoutTime: string, hasUnsettledBalance: boolean) => string;
  }
> = {
  ar: {
    title: 'نتمنى أن تكون استمتعت بإقامتك 🌅',
    body: (c, bal) =>
      `المغادرة اليوم ${c}` +
      (bal ? ' — لديك مشتريات على حساب الغرفة، يمكنك تسويتها عند الاستقبال' : ''),
  },
  en: {
    title: 'We hope you enjoyed your stay 🌅',
    body: (c, bal) =>
      `Checkout is today at ${c}` +
      (bal ? ' — you have room-charge purchases; settle them at reception' : ''),
  },
  ru: {
    title: 'Надеемся, вам понравилось у нас 🌅',
    body: (c, bal) =>
      `Выезд сегодня в ${c}` +
      (bal
        ? ' — на вашем счёте есть покупки в номер, их можно оплатить на ресепшене'
        : ''),
  },
  fr: {
    title: 'Nous espérons que votre séjour vous a plu 🌅',
    body: (c, bal) =>
      `Le départ est aujourd’hui à ${c}` +
      (bal
        ? ' — vous avez des achats sur la note de chambre ; vous pouvez les régler à la réception'
        : ''),
  },
  it: {
    title: 'Speriamo che il tuo soggiorno sia stato piacevole 🌅',
    body: (c, bal) =>
      `Il check-out è oggi alle ${c}` +
      (bal
        ? ' — hai acquisti addebitati sulla camera; puoi saldarli alla reception'
        : ''),
  },
  es: {
    title: 'Esperamos que hayas disfrutado tu estancia 🌅',
    body: (c, bal) =>
      `La salida es hoy a las ${c}` +
      (bal
        ? ' — tienes compras cargadas a la habitación; puedes liquidarlas en recepción'
        : ''),
  },
  de: {
    title: 'Wir hoffen, dein Aufenthalt hat dir gefallen 🌅',
    body: (c, bal) =>
      `Die Abreise ist heute um ${c} Uhr` +
      (bal
        ? ' — du hast Einkäufe auf der Zimmerrechnung; du kannst sie an der Rezeption begleichen'
        : ''),
  },
};

export function composeCheckoutReminder(
  lang: GuestLanguage,
  checkoutTime: string,
  hasUnsettledBalance: boolean,
): PushLine {
  const spec = CHECKOUT_REMINDER[lang];
  return { title: spec.title, body: spec.body(checkoutTime, hasUnsettledBalance) };
}
