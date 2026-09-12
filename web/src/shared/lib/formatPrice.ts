export const formatPrice = (price: number) => {
  return `${new Intl.NumberFormat("kk-KZ").format(price)} ₸`;
};
