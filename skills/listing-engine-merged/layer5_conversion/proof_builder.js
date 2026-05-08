// layer5_conversion/proof/proof_builder.js

function proofBuilder(attributes = {}) {
  const proofs = [];

  if (attributes.material?.value) {
    proofs.push({
      type: "material",
      text: `Made with premium ${attributes.material.value}`
    });
  }

  if (attributes.certification?.value) {
    proofs.push({
      type: "cert",
      text: `${attributes.certification.value} certified`
    });
  }

  if (attributes.size?.value) {
    proofs.push({
      type: "usage",
      text: `Designed for ${attributes.size.value}`
    });
  }

  return proofs;
}