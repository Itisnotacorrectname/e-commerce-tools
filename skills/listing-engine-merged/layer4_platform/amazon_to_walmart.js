function mapAmazonToWalmart(input) {
  const { product, amazonListing } = input;

  return {
    product,
    walmartDraft: {
      title: amazonListing.title,
      highlights: amazonListing.bullets,
      description: amazonListing.bullets.join(" "),
      attributes: product.attributes
    }
  };
}